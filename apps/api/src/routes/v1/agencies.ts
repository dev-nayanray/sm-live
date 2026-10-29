import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { requireAdmin } from "../../lib/auth.js";

export async function agencyRoutes(app: FastifyInstance) {
  /** Public-ish: agency tree for the calling user (agency members see their subtree). */
  app.get("/v1/agencies/tree", async (req) => {
    const { user } = await requireUser(req);
    if (!user.agencyId) {
      const root = await prisma.agency.findMany({ where: { parentId: null }, include: { _count: { select: { users: true, children: true } } } });
      return { ok: true, data: root.map(toNode) };
    }
    const subtree = await loadSubtree(user.agencyId);
    return { ok: true, data: [subtree] };
  });

  /** Agency panel: coin/commission summary for the member's agency. */
  app.get("/v1/agencies/panel", async (req) => {
    const { user } = await requireUser(req);
    if (!user.agencyId) throw forbidden("not an agency member");
    const agency = await prisma.agency.findUnique({ where: { id: user.agencyId } });
    if (!agency) throw notFound("agency not found");
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [commission, members, recharges] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: { kind: "agency_commission", refId: agency.id, createdAt: { gte: since } },
        _sum: { amount: true },
      }),
      prisma.agencyMember.count({ where: { agencyId: agency.id } }),
      prisma.recharge.aggregate({ where: { user: { agencyId: agency.id }, createdAt: { gte: since } }, _sum: { amount: true } }),
    ]);
    return {
      ok: true,
      data: {
        agency: { id: agency.id, name: agency.name, commissionRate: agency.commissionRate },
        last30d: {
          commissionEarned: commission._sum.amount ?? 0,
          memberRecharges: recharges._sum.amount ?? 0,
          members,
        },
      },
    };
  });
}

export async function loadSubtree(agencyId: number) {
  const roots = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: { _count: { select: { users: true } } },
  });
  if (!roots) throw notFound("agency not found");
  const children = await prisma.agency.findMany({
    where: { parentId: agencyId },
    include: { _count: { select: { users: true } } },
  });
  return {
    ...toNode(roots),
    children: children.map(toNode),
  };
}

function toNode(a: { id: number; name: string; code: string; commissionRate: number; parentId: number | null; _count?: { users: number; children?: number } }) {
  return {
    id: a.id,
    name: a.name,
    code: a.code,
    commissionRate: a.commissionRate,
    parentId: a.parentId,
    userCount: a._count?.users ?? 0,
  };
}
