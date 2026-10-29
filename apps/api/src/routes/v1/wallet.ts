import type { FastifyInstance } from "fastify";
import { rechargeSchema } from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { validate, bodyOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { credit } from "../../services/ledger.service.js";
import { getPaymentAdapter } from "../../services/payment.adapter.js";
import { paginationQuery } from "@sm-live/shared";

export async function walletRoutes(app: FastifyInstance) {
  app.get("/v1/wallet/balance", async (req) => {
    const { user } = await requireUser(req);
    const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
    return { ok: true, data: { balance: w?.balance ?? 0, frozen: w?.frozen ?? false, currency: "coins" } };
  });

  app.get("/v1/wallet/history", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(paginationQuery, queryOf(req));
    const where = { userId: user.id };
    const [total, rows] = await Promise.all([
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((r) => ({
          id: r.id.toString(),
          kind: r.kind,
          amount: r.amount,
          balanceAfter: r.balanceAfter,
          txKey: r.txKey,
          createdAt: r.createdAt,
        })),
      },
    };
  });

  app.post("/v1/wallet/recharge", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(rechargeSchema, bodyOf(req));
    const { user } = await requireUser(req);
    const adapter = getPaymentAdapter(input.provider);
    const charge = await adapter.createCharge({ userId: user.id, amount: input.amount, meta: input.meta });
    const recharge = await prisma.recharge.create({
      data: {
        userId: user.id,
        amount: input.amount,
        provider: input.provider,
        externalId: charge.externalId,
        status: charge.status,
        meta: (input.meta ?? undefined) as never,
      },
    });
    if (charge.status === "succeeded") {
      await credit(user.id, "recharge", input.amount, `recharge:${recharge.id}`, { refType: "recharge", refId: recharge.id });
    }
    const w = await prisma.wallet.findUnique({ where: { userId: user.id } });
    return { ok: true, data: { rechargeId: recharge.id, status: recharge.status, balance: w?.balance ?? 0 } };
  });
}
