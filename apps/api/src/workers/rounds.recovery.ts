import { prisma } from "../lib/prisma.js";
import { postLedgerEntries } from "../services/ledger.service.js";
import { logger } from "../lib/logger.js";

/**
 * Stuck-round recovery: rounds still `open` past their configured timeout are
 * resolved per GameConfig.stuckPolicy — "refund" returns placed bets,
 * "settle" marks them lost. Idempotent via the ledger txKeys and round status.
 */
export async function recoverStuckRounds(): Promise<{ scanned: number; refunded: number; settled: number }> {
  const cutoff = new Date();
  const stale = await prisma.gameRound.findMany({
    where: { status: "open", startedAt: { lt: cutoff } },
    include: {
      game: { include: { configs: true } },
      bets: { where: { status: "placed" } },
    },
    take: 200,
  });

  let refunded = 0;
  let settled = 0;

  for (const round of stale) {
    const config = round.game.configs[0];
    const timeoutSeconds = config?.timeoutSeconds ?? 120;
    const deadline = new Date(round.startedAt.getTime() + timeoutSeconds * 1000);
    if (deadline > cutoff) continue; // still inside its window

    const policy = config?.stuckPolicy ?? "refund";
    if (policy === "refund") {
      await prisma.$transaction(async (tx) => {
        for (const bet of round.bets) {
          await postLedgerEntries(
            [{ userId: bet.userId, kind: "bet_refund", amount: bet.amount, txKey: `betrefund:recovery:${bet.id}`, refType: "bet", refId: bet.id, meta: { roundId: round.roundId } }],
            tx
          );
          await tx.bet.update({ where: { id: bet.id }, data: { status: "refunded", settledAt: new Date() } });
        }
        await tx.gameRound.update({ where: { id: round.id }, data: { status: "cancelled", endedAt: new Date(), settleSource: "recovery" } });
      });
      refunded++;
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.bet.updateMany({ where: { roundId: round.id, status: "placed" }, data: { status: "lost", settledAt: new Date() } });
        await tx.gameRound.update({ where: { id: round.id }, data: { status: "settled", endedAt: new Date(), settleSource: "recovery" } });
      });
      settled++;
    }
  }

  if (stale.length > 0) logger.info({ scanned: stale.length, refunded, settled }, "stuck round recovery done");
  return { scanned: stale.length, refunded, settled };
}
