import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * Generate a draft ProviderBill per provider for the previous calendar month:
 * grossBets, grossPayout, commission (provider commissionPct), service fee,
 * netPayable. Idempotent — one draft bill per provider per period.
 */
export async function generateProviderBills(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const providers = await prisma.gameProvider.findMany();
  const results: { provider: string; billId: number; netPayable: number; duplicate: boolean }[] = [];

  for (const p of providers) {
    const existing = await prisma.providerBill.findFirst({ where: { providerId: p.id, periodStart } });
    if (existing) {
      results.push({ provider: p.code, billId: existing.id, netPayable: existing.netPayable, duplicate: true });
      continue;
    }
    const [betsAgg, payoutsAgg, fees] = await Promise.all([
      prisma.bet.aggregate({
        where: { game: { providerId: p.id }, createdAt: { gte: periodStart, lt: periodEnd } },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({
        where: { bet: { game: { providerId: p.id } }, createdAt: { gte: periodStart, lt: periodEnd } },
        _sum: { amount: true },
      }),
      prisma.monthlyServiceFee.findUnique({ where: { providerId_month: { providerId: p.id, month: periodStart } } }),
    ]);
    const grossBets = betsAgg._sum.amount ?? 0;
    const grossPayout = payoutsAgg._sum.amount ?? 0;
    const commissionAmount = Math.floor((grossBets - grossPayout) * (p.commissionPct / 100));
    const serviceFee = fees?.amount ?? 0;
    const netPayable = commissionAmount - serviceFee;
    const bill = await prisma.providerBill.create({
      data: {
        providerId: p.id, periodStart, periodEnd,
        grossBets, grossPayout,
        commissionPct: p.commissionPct,
        commissionAmount, serviceFee, netPayable,
        status: "draft",
      },
    });
    results.push({ provider: p.code, billId: bill.id, netPayable, duplicate: false });
  }
  logger.info({ bills: results.length }, "provider bills generated");
  return results;
}
