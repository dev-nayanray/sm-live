import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/** Daily revenue rollup into DailyRevenue (idempotent per day — upsert). */
export async function dailyRevenueRollup(day?: Date): Promise<{ day: string; betsAmount: number; winsAmount: number; revenue: number }> {
  const target = day ?? new Date();
  const start = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate() - 1));
  const end = new Date(start.getTime() + 86400_000);
  const [betsAgg, winsAgg, giftsAgg, rechargeAgg] = await Promise.all([
    prisma.bet.aggregate({ where: { createdAt: { gte: start, lt: end } }, _count: true, _sum: { amount: true } }),
    prisma.payout.aggregate({ where: { createdAt: { gte: start, lt: end } }, _count: true, _sum: { amount: true } }),
    prisma.giftTransaction.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { totalPrice: true } }),
    prisma.recharge.aggregate({ where: { createdAt: { gte: start, lt: end }, status: "succeeded" }, _count: true, _sum: { amount: true } }),
  ]);
  const betsAmount = betsAgg._sum.amount ?? 0;
  const winsAmount = winsAgg._sum.amount ?? 0;
  const revenue = betsAmount - winsAmount;
  await prisma.dailyRevenue.upsert({
    where: { day: start },
    create: {
      day: start,
      betsCount: betsAgg._count,
      betsAmount,
      winsCount: winsAgg._count,
      winsAmount,
      giftsAmount: giftsAgg._sum.totalPrice ?? 0,
      recharges: rechargeAgg._count,
      revenue,
    },
    update: { betsCount: betsAgg._count, betsAmount, winsCount: winsAgg._count, winsAmount, giftsAmount: giftsAgg._sum.totalPrice ?? 0, recharges: rechargeAgg._count, revenue },
  });
  logger.info({ day: start.toISOString().slice(0, 10), betsAmount, winsAmount, revenue }, "daily rollup");
  return { day: start.toISOString().slice(0, 10), betsAmount, winsAmount, revenue };
}

/** Hourly RTP snapshot per game (realized return = payouts / bets). */
export async function rtpSnapshot(): Promise<{ games: number }> {
  const since = new Date(Date.now() - 3600_000);
  const games = await prisma.game.findMany({ include: { bets: { where: { createdAt: { gte: since } } } } });
  let count = 0;
  for (const g of games) {
    const totalBet = g.bets.reduce((s: number, b) => s + b.amount, 0);
    const payouts = await prisma.payout.aggregate({
      where: { bet: { gameKey: g.id }, createdAt: { gte: since } },
      _sum: { amount: true },
    });
    const totalPayout = payouts._sum.amount ?? 0;
    await prisma.rtpSnapshot.create({
      data: {
        gameId: g.id,
        windowStart: since,
        windowEnd: new Date(),
        totalBet,
        totalPayout,
        rtp: totalBet > 0 ? totalPayout / totalBet : 0,
      },
    });
    count++;
  }
  return { games: count };
}

/** Monthly service fee rows per provider (configurable amount from Settings). */
export async function monthlyServiceFees(): Promise<{ created: number }> {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const feeSetting = await prisma.setting.findUnique({ where: { key: "provider.monthly_service_fee" } });
  const amount = feeSetting ? Number(feeSetting.value) : 100;
  const providers = await prisma.gameProvider.findMany();
  let created = 0;
  for (const p of providers) {
    const res = await prisma.monthlyServiceFee.upsert({
      where: { providerId_month: { providerId: p.id, month } },
      create: { providerId: p.id, month, amount, note: "auto monthly service fee" },
      update: { amount },
    });
    if (res) created++;
  }
  return { created };
}
