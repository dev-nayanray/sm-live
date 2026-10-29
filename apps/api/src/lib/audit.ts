import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export async function writeAudit(args: {
  adminId?: number | null;
  req?: FastifyRequest;
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: args.adminId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId != null ? String(args.entityId) : null,
        before: (args.before ?? undefined) as never,
        after: (args.after ?? undefined) as never,
        ip: args.req?.ip ?? "",
      },
    });
  } catch (e) {
    logger.error({ err: e }, "audit log write failed");
  }
}

export async function recordApiError(source: string, route: string, message: string, payload?: unknown) {
  try {
    await prisma.apiErrorLog.create({
      data: { source, route, message: message.slice(0, 500), payload: (payload ?? undefined) as never },
    });
  } catch {
    /* swallow */
  }
}

export async function recordSecurityEvent(kind: string, message: string, ip: string, meta?: unknown) {
  try {
    await prisma.securityEvent.create({
      data: { kind, message: message.slice(0, 300), ip, meta: (meta ?? undefined) as never },
    });
  } catch {
    /* swallow */
  }
}
