import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { postLedgerEntries, ledgerIntegrityCheck } from "../src/services/ledger.service.js";

let userId: number;

async function freshUser(prefix: string) {
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await prisma.user.create({
    data: { phone: `+88016600${suffix}`, passwordHash: "x", displayName: `${prefix} ${suffix}` },
  });
  await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  return user.id;
}

beforeAll(async () => {
  userId = await freshUser("LedgerTest");
});

describe("ledger service", () => {
  it("credits update balance and store balanceAfter", async () => {
    const res = await postLedgerEntries([
      { userId, kind: "recharge", amount: 1000, txKey: `t:credit:${crypto.randomUUID()}` },
    ]);
    expect(res.entries[0]!.balanceAfter).toBe(1000);
    expect(res.balances[userId]).toBe(1000);
  });

  it("rejects a debit below zero", async () => {
    await expect(
      postLedgerEntries([{ userId, kind: "bet_debit", amount: -2000, txKey: `t:over:${crypto.randomUUID()}` }])
    ).rejects.toMatchObject({ status: 422 });
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(w.balance).toBe(1000);
  });

  it("is idempotent on the same txKey (replay returns original row, no double credit)", async () => {
    const txKey = `t:idem:${crypto.randomUUID()}`;
    const first = await postLedgerEntries([{ userId, kind: "win_credit", amount: 500, txKey }]);
    const replay = await postLedgerEntries([{ userId, kind: "win_credit", amount: 500, txKey }]);
    expect(replay.replayed).toBe(true);
    expect(replay.entries[0]!.id).toBe(first.entries[0]!.id);
    expect(replay.entries[0]!.balanceAfter).toBe(1500);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(w.balance).toBe(1500);
  });

  it("applies multi-user batches atomically with per-user running balances", async () => {
    const otherId = await freshUser("LedgerPeer");
    const tx = crypto.randomUUID();
    const res = await postLedgerEntries([
      { userId: otherId, kind: "recharge", amount: 100, txKey: `t:multi:a:${tx}` },
      { userId, kind: "gift_debit", amount: -200, txKey: `t:multi:b:${tx}` },
      { userId, kind: "admin_adjust", amount: 50, txKey: `t:multi:c:${tx}` },
    ]);
    expect(res.balances[userId]).toBe(1350);
    expect(res.balances[otherId]).toBe(100);
    // entries for the same user carry sequential balanceAfter
    const mine = res.entries.filter((e) => e.userId === userId);
    expect(mine.map((e) => e.balanceAfter)).toEqual([1300, 1350]);
  });

  it("concurrent same-txKey calls apply exactly once", async () => {
    const txKey = `t:race:${crypto.randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => postLedgerEntries([{ userId, kind: "recharge", amount: 10, txKey }]))
    );
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    expect(okCount).toBe(10); // all succeed: 1 apply + 9 replays
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    expect(w.balance).toBe(1360); // +100 only once
  });

  it("ledger sums always equal wallet balances", async () => {
    const check = await ledgerIntegrityCheck([userId]);
    expect(check.ok).toBe(true);
  });

  it("rejects zero amounts and duplicate txKeys inside one batch", async () => {
    await expect(postLedgerEntries([{ userId, kind: "recharge", amount: 0, txKey: "t:zero" }])).rejects.toMatchObject({ status: 422 });
    await expect(
      postLedgerEntries([
        { userId, kind: "recharge", amount: 5, txKey: "t:dup" },
        { userId, kind: "recharge", amount: 5, txKey: "t:dup" },
      ])
    ).rejects.toMatchObject({ status: 422 });
  });
});
