import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sendGiftSchema, paginationQuery } from "@sm-live/shared";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { validate, bodyOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { postLedgerEntries, type LedgerEntryInput } from "../../services/ledger.service.js";
import { emitToRoom } from "../../socket.js";
import { createNotification } from "./notifications.js";

/**
 * Gift send: single atomic ledger batch —
 * debit sender, credit host (minus agency commission), credit agency.
 */
export async function giftRoutes(app: FastifyInstance) {
  app.post("/v1/gifts/send", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(sendGiftSchema, bodyOf(req));
    const { user: sender } = await requireUser(req);

    let recipientId = input.recipientId ?? null;
    if (!recipientId && input.roomId) {
      const room = await prisma.room.findUnique({ where: { id: input.roomId } });
      if (!room) throw notFound("room not found");
      recipientId = room.hostId;
    }
    if (!recipientId) throw badRequest("recipientId or roomId required");
    if (recipientId === sender.id) throw badRequest("cannot send gift to yourself");

    const gift = await prisma.gift.findUnique({ where: { id: input.giftId } });
    if (!gift || !gift.enabled) throw notFound("gift not found");
    const totalPrice = gift.price * input.quantity;

    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, include: { agency: true } });
    if (!recipient) throw notFound("recipient not found");

    const commissionRate = recipient.agency?.commissionRate ?? 0;
    const commission = Math.floor(totalPrice * commissionRate);
    const hostCredit = totalPrice - commission;
    const txId = crypto.randomUUID();

    const entries: LedgerEntryInput[] = [
      { userId: sender.id, kind: "gift_debit", amount: -totalPrice, txKey: `gift:debit:${txId}`, refType: "gift_tx", meta: { giftId: gift.id, quantity: input.quantity } },
    ];
    if (hostCredit > 0) {
      entries.push({ userId: recipient.id, kind: "gift_credit", amount: hostCredit, txKey: `gift:credit:${txId}`, refType: "gift_tx", meta: { giftId: gift.id, from: sender.id } });
    }
    if (commission > 0 && recipient.agencyId) {
      // agency settlement account: the agency's owner user (first member admin) receives commission
      const agencyAdmin = await prisma.adminUser.findFirst({ where: { agencyId: recipient.agencyId } });
      const agencyUser = agencyAdmin
        ? null
        : await prisma.agencyMember.findFirst({ where: { agencyId: recipient.agencyId! }, orderBy: { id: "asc" } });
      const commissionUserId = agencyUser?.userId;
      if (commissionUserId) {
        entries.push({ userId: commissionUserId, kind: "agency_commission", amount: commission, txKey: `gift:agency:${txId}`, refType: "agency", refId: recipient.agencyId!, meta: { rate: commissionRate } });
      }
    }

    const result = await postLedgerEntries(entries);

    const giftTx = await prisma.giftTransaction.create({
      data: {
        senderId: sender.id,
        recipientId: recipient.id,
        giftId: gift.id,
        roomId: input.roomId ?? null,
        quantity: input.quantity,
        totalPrice,
        agencyCommission: commission,
      },
    });

    // ranking points: 1 point per coin gifted, for sender
    await prisma.ranking.upsert({
      where: { userId_period_scope: { userId: sender.id, period: currentPeriod(), scope: "global" } },
      create: { userId: sender.id, period: currentPeriod(), scope: "global", points: totalPrice },
      update: { points: { increment: totalPrice } },
    });

    if (input.roomId) {
      emitToRoom(input.roomId, "gift:broadcast", {
        giftId: gift.id,
        name: gift.name,
        iconUrl: gift.iconUrl,
        animation: gift.animation,
        quantity: input.quantity,
        totalPrice,
        from: { id: sender.id, displayName: sender.displayName },
        to: { id: recipient.id, displayName: recipient.displayName },
      });
    }

    // Create a notification for the gift recipient.
    await createNotification({
      userId: recipient.id,
      category: "gift",
      title: "You received a gift!",
      body: `${sender.displayName} sent you ${input.quantity}× ${gift.name} (${totalPrice} coins).`,
      link: input.roomId ? `/room/${input.roomId}` : `/profile/${sender.id}`,
      meta: { giftTransactionId: giftTx.id, giftName: gift.name, senderId: sender.id, totalPrice },
    });

    return {
      ok: true,
      data: {
        giftTransactionId: giftTx.id,
        totalPrice,
        hostCredit,
        agencyCommission: commission,
        balances: result.balances,
      },
    };
  });

  app.get("/v1/gifts/ranking", async (req) => {
    const period = ((req.query as { period?: string }).period ?? "weekly") as "daily" | "weekly" | "monthly";
    const rows = await prisma.ranking.findMany({
      where: { period, scope: "global" },
      orderBy: { points: "desc" },
      take: 50,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } } },
    });
    return { ok: true, data: rows.map((r, i) => ({ rank: i + 1, user: r.user, points: r.points })) };
  });

  /**
   * List available gifts for the gift store (Prompt 20).
   *
   * Returns all enabled gifts, paginated + filterable by category.
   * Used by the mobile Gift Store screen. The `price` is the authoritative
   * coin price — the client MUST NOT override it.
   */
  app.get("/v1/gifts", async (req) => {
    await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      category: z.string().trim().max(40).optional(),
      search: z.string().trim().max(60).optional(),
    }), queryOf(req));

    const where: { enabled: boolean; category?: string; name?: { contains: string } } = { enabled: true };
    if (q.category) where.category = q.category;
    if (q.search) where.name = { contains: q.search };

    const [total, items] = await Promise.all([
      prisma.gift.count({ where }),
      prisma.gift.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
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
        items: items.map((g) => ({
          id: g.id,
          name: g.name,
          iconUrl: g.iconUrl,
          price: g.price,
          category: g.category,
          animation: g.animation,
          enabled: g.enabled,
          sortOrder: g.sortOrder,
        })),
      },
    };
  });

  /**
   * Gift history — sent by the current user (Prompt 20).
   *
   * Returns GiftTransaction rows where senderId = user.id, paginated,
   * newest first. Each row includes the gift name + recipient display
   * name so the UI can render a history list without a second fetch.
   */
  app.get("/v1/gifts/sent", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.giftTransaction.count({ where: { senderId: user.id } }),
      prisma.giftTransaction.findMany({
        where: { senderId: user.id },
        include: {
          gift: { select: { id: true, name: true, iconUrl: true, price: true, category: true } },
          recipient: { select: { id: true, displayName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
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
        items: items.map((t) => ({
          id: t.id,
          giftId: t.giftId,
          giftName: t.gift.name,
          giftIconUrl: t.gift.iconUrl,
          giftPrice: t.gift.price,
          giftCategory: t.gift.category,
          recipientId: t.recipientId,
          recipientName: t.recipient.displayName,
          recipientAvatarUrl: t.recipient.avatarUrl,
          quantity: t.quantity,
          totalPrice: t.totalPrice,
          agencyCommission: t.agencyCommission,
          roomId: t.roomId,
          createdAt: t.createdAt,
        })),
      },
    };
  });

  /**
   * Gift history — received by the current user (Prompt 20).
   *
   * Returns GiftTransaction rows where recipientId = user.id, paginated,
   * newest first. Each row includes the gift name + sender display name.
   */
  app.get("/v1/gifts/received", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.giftTransaction.count({ where: { recipientId: user.id } }),
      prisma.giftTransaction.findMany({
        where: { recipientId: user.id },
        include: {
          gift: { select: { id: true, name: true, iconUrl: true, price: true, category: true } },
          sender: { select: { id: true, displayName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
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
        items: items.map((t) => ({
          id: t.id,
          giftId: t.giftId,
          giftName: t.gift.name,
          giftIconUrl: t.gift.iconUrl,
          giftPrice: t.gift.price,
          giftCategory: t.gift.category,
          senderId: t.senderId,
          senderName: t.sender.displayName,
          senderAvatarUrl: t.sender.avatarUrl,
          quantity: t.quantity,
          totalPrice: t.totalPrice,
          agencyCommission: t.agencyCommission,
          roomId: t.roomId,
          createdAt: t.createdAt,
        })),
      },
    };
  });
}

export function currentPeriod(): string {
  const now = new Date();
  if (now.getUTCDay() === 1) return "weekly";
  return "daily";
}
