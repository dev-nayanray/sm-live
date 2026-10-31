import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { emitToRoom } from "../../socket.js";

/**
 * SM Live — Notifications + User Support API (Prompt 23).
 *
 * Notifications:
 *   GET    /v1/notifications           — paginated list (newest first)
 *   GET    /v1/notifications/count      — unread count (replaces the stub)
 *   POST   /v1/notifications/:id/read  — mark one as read
 *   POST   /v1/notifications/read-all  — mark all as read
 *
 * User-facing support (the admin endpoints at /v1/admin/support/* already
 * exist from Prompt 11; these are the user-side counterparts):
 *   GET    /v1/support/tickets          — paginated list of my tickets
 *   POST   /v1/support/tickets           — create a new ticket
 *   GET    /v1/support/tickets/:id       — ticket detail + messages (non-internal only)
 *   POST   /v1/support/tickets/:id/messages — reply to a ticket
 */
export async function notificationRoutes(app: FastifyInstance) {
  // --- Notifications ---

  app.get("/v1/notifications", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
      unreadOnly: z.enum(["true", "false"]).default("false"),
    }), queryOf(req));

    const where = {
      userId: user.id,
      ...(q.unreadOnly === "true" ? { readAt: null } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.appNotification.count({ where }),
      prisma.appNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((n) => ({
          id: n.id,
          category: n.category,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.readAt !== null,
          meta: n.meta,
          createdAt: n.createdAt,
        })),
      },
    };
  });

  app.get("/v1/notifications/count", async (req) => {
    const { user } = await requireUser(req);
    const unread = await prisma.appNotification.count({
      where: { userId: user.id, readAt: null },
    });
    const total = await prisma.appNotification.count({
      where: { userId: user.id },
    });
    return { ok: true, data: { unread, total, supported: true } };
  });

  app.post("/v1/notifications/:id/read", async (req) => {
    const { user } = await requireUser(req);
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    await prisma.appNotification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.post("/v1/notifications/read-all", async (req) => {
    const { user } = await requireUser(req);
    await prisma.appNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  // --- User-facing support tickets ---

  app.get("/v1/support/tickets", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
      status: z.string().trim().max(30).optional(),
    }), queryOf(req));

    const where = {
      userId: user.id,
      ...(q.status ? { status: q.status } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          messages: {
            where: { isInternal: false },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, createdAt: true, authorType: true },
          },
        },
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((t) => ({
          id: t.id,
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          lastMessage: t.messages[0]?.body ?? null,
          lastMessageAt: t.messages[0]?.createdAt ?? null,
        })),
      },
    };
  });

  app.post("/v1/support/tickets", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const input = validate(z.object({
      subject: z.string().trim().min(3).max(120),
      description: z.string().trim().min(1).max(4000),
      category: z.string().trim().max(40).default("other"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    }), bodyOf(req));

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject: input.subject,
        description: input.description,
        category: input.category,
        priority: input.priority,
        status: "new",
      },
    });

    // Create the first message (the user's initial description).
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: null, // null = user
        authorType: "user",
        body: input.description,
        isInternal: false,
      },
    });

    // Create a notification for all support admins (simplified: notify
    // super_admin role). In production this would be a background job.
    // For now, we skip the admin notification and just return the ticket.

    return { ok: true, data: { id: ticket.id, status: ticket.status } };
  });

  app.get("/v1/support/tickets/:id", async (req) => {
    const { user } = await requireUser(req);
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: {
          where: { isInternal: false }, // NEVER expose internal notes to users
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) throw notFound("ticket not found");
    if (ticket.userId !== user.id) throw badRequest("you do not have access to this ticket");

    return {
      ok: true,
      data: {
        id: ticket.id,
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        messages: ticket.messages.map((m) => ({
          id: m.id,
          body: m.body,
          authorType: m.authorType,
          createdAt: m.createdAt,
        })),
      },
    };
  });

  app.post("/v1/support/tickets/:id/messages", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      body: z.string().trim().min(1).max(2000),
    }), bodyOf(req));

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw notFound("ticket not found");
    if (ticket.userId !== user.id) throw badRequest("you do not have access to this ticket");
    if (ticket.status === "closed") throw badRequest("ticket is closed");

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        authorId: null,
        authorType: "user",
        body: input.body,
        isInternal: false,
      },
    });

    // Move ticket to "waiting_user" → actually back to "waiting_internal"
    // since the user just replied and is now waiting for admin.
    await prisma.supportTicket.update({
      where: { id },
      data: { status: "waiting_internal" },
    });

    return { ok: true, data: { id: message.id, createdAt: message.createdAt } };
  });
}

// --- Helper: create a notification (used by other routes) ---

export async function createNotification(args: {
  userId: number;
  category: string;
  title: string;
  body?: string;
  link?: string;
  meta?: Record<string, unknown>;
}) {
  const n = await prisma.appNotification.create({
    data: {
      userId: args.userId,
      category: args.category,
      title: args.title,
      body: args.body ?? "",
      link: args.link ?? "",
      meta: (args.meta ?? undefined) as never,
    },
  });
  // Emit a real-time event so the mobile client can update the badge.
  emitToRoom(args.userId, "notification:new", {
    id: n.id,
    category: n.category,
    title: n.title,
    link: n.link,
    createdAt: n.createdAt,
  });
  return n;
}
