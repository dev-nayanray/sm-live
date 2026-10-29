import { Prisma, type LedgerEntry } from "@prisma/client";
import type { LedgerKind } from "@sm-live/shared";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface LedgerEntryInput {
  userId: number;
  kind: LedgerKind;
  /** signed coins: positive = credit, negative = debit */
  amount: number;
  /** globally unique idempotency key; replays return the original rows */
  txKey: string;
  refType?: string;
  refId?: number;
  meta?: Record<string, unknown>;
}

export interface PostedEntry {
  id: bigint;
  userId: number;
  txKey: string;
  amount: number;
  balanceAfter: number;
  kind: string;
  replayed: boolean;
}

export interface LedgerResult {
  entries: PostedEntry[];
  replayed: boolean; // true if ANY entry was an idempotent replay
  balances: Record<number, number>;
}

/**
 * THE single coin-movement path. Rules enforced:
 *  - every row immutable (insert-only; no updates ever)
 *  - unique txKey → idempotent replays return the original entry, never double-apply
 *  - wallet rows are locked FOR UPDATE (ordered by userId to avoid deadlocks)
 *  - running balance may never go negative (checked per entry, in order)
 *  - balanceAfter persisted on every row and wallet.balance equals the last balanceAfter
 */
export async function postLedgerEntries(inputs: LedgerEntryInput[], tx?: PrismaTx): Promise<LedgerResult> {
  if (inputs.length === 0) return { entries: [], replayed: false, balances: {} };
  for (const i of inputs) {
    if (!Number.isInteger(i.amount) || i.amount === 0) {
      throw new AppError("ledger_invalid_amount", `txKey=${i.txKey} amount must be a non-zero integer`, 422);
    }
    if (inputs.filter((x) => x.txKey === i.txKey).length > 1) {
      throw new AppError("ledger_duplicate_txkey", `duplicate txKey in one batch: ${i.txKey}`, 422);
    }
  }

  return prisma.$transaction(async (t) => {
    const db = tx ?? t;

    // 1. Lock every wallet involved, in deterministic order (no deadlocks).
    const userIds = [...new Set(inputs.map((i) => i.userId))].sort((a, b) => a - b);
    const locked = await db.$queryRaw<{ userId: number; id: number; balance: number }[]>`
      SELECT "userId", "id", "balance" FROM "Wallet"
      WHERE "userId" = ANY(${userIds}::int[])
      ORDER BY "userId"
      FOR UPDATE`;
    const wallets = new Map(locked.map((w) => [w.userId, w]));
    for (const uid of userIds) {
      if (!wallets.has(uid)) throw new AppError("wallet_missing", `wallet for user ${uid} not found`, 422);
    }
    // frozen wallet check
    const frozenRows = await db.wallet.findMany({ where: { userId: { in: userIds }, frozen: true } });
    if (frozenRows.length > 0) {
      throw new AppError("wallet_frozen", `wallet frozen for user ${frozenRows[0]!.userId}`, 422);
    }

    // 2. Idempotency: already-committed txKeys are replays.
    const txKeys = inputs.map((i) => i.txKey);
    const existing = await db.ledgerEntry.findMany({ where: { txKey: { in: txKeys } } });
    const existingByTx = new Map(existing.map((e) => [e.txKey, e]));

    const balances = new Map<number, number>(locked.map((w) => [w.userId, w.balance]));
    const entries: PostedEntry[] = [];
    let anyReplay = false;

    for (const input of inputs) {
      const prior = existingByTx.get(input.txKey);
      if (prior) {
        anyReplay = true;
        entries.push(toPosted(prior, true));
        continue; // never re-apply a committed movement
      }
      const wallet = wallets.get(input.userId)!;
      const running = (balances.get(input.userId) ?? wallet.balance) + input.amount;
      if (running < 0) {
        throw new AppError(
          "insufficient_funds",
          `user ${input.userId} balance ${balances.get(input.userId)} cannot debit ${-input.amount} (txKey=${input.txKey})`,
          422
        );
      }
      balances.set(input.userId, running);
      const row = await db.ledgerEntry.create({
        data: {
          userId: input.userId,
          walletId: wallet.id,
          kind: input.kind,
          amount: input.amount,
          balanceAfter: running,
          txKey: input.txKey,
          refType: input.refType,
          refId: input.refId,
          meta: (input.meta ?? undefined) as never,
        },
      });
      await db.wallet.update({ where: { id: wallet.id }, data: { balance: running } });
      entries.push(toPosted(row, false));
    }

    return {
      entries,
      replayed: anyReplay,
      balances: Object.fromEntries(balances),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
}

function toPosted(e: LedgerEntry, replayed: boolean): PostedEntry {
  return {
    id: e.id,
    userId: e.userId,
    txKey: e.txKey,
    amount: e.amount,
    balanceAfter: e.balanceAfter,
    kind: e.kind,
    replayed,
  };
}

/** Convenience wrappers ------------------------------------------------- */
export async function credit(userId: number, kind: LedgerKind, amount: number, txKey: string, extra?: Omit<LedgerEntryInput, "userId" | "kind" | "amount" | "txKey">, tx?: PrismaTx) {
  return postLedgerEntries([{ userId, kind, amount, txKey, ...extra }], tx);
}

export async function debit(userId: number, kind: LedgerKind, amount: number, txKey: string, extra?: Omit<LedgerEntryInput, "userId" | "kind" | "amount" | "txKey">, tx?: PrismaTx) {
  return postLedgerEntries([{ userId, kind, amount: -amount, txKey, ...extra }], tx);
}

export async function balanceOf(userId: number): Promise<number> {
  const w = await prisma.wallet.findUnique({ where: { userId } });
  if (!w) throw new AppError("wallet_missing", `wallet for user ${userId} not found`, 422);
  return w.balance;
}

/** Audit helper: ledger integrity check — sum of entries per user must equal wallet balance. */
export async function ledgerIntegrityCheck(userIds?: number[]): Promise<{ ok: boolean; mismatches: { userId: number; ledgerSum: number; walletBalance: number }[] }> {
  const sums = await prisma.ledgerEntry.groupBy({
    by: ["userId"],
    _sum: { amount: true },
    ...(userIds ? { where: { userId: { in: userIds } } } : {}),
  });
  const wallets = await prisma.wallet.findMany({
    where: userIds ? { userId: { in: userIds } } : {},
    select: { userId: true, balance: true },
  });
  const walletByUser = new Map(wallets.map((w) => [w.userId, w.balance]));
  const mismatches: { userId: number; ledgerSum: number; walletBalance: number }[] = [];
  for (const s of sums) {
    const ledgerSum = s._sum.amount ?? 0;
    const walletBalance = walletByUser.get(s.userId) ?? 0;
    if (ledgerSum !== walletBalance) mismatches.push({ userId: s.userId, ledgerSum, walletBalance });
  }
  return { ok: mismatches.length === 0, mismatches };
}
