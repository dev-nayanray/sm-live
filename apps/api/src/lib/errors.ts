import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
    public details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError("bad_request", m, 400, d);
export const unauthorized = (m = "unauthorized") => new AppError("unauthorized", m, 401);
export const forbidden = (m = "forbidden") => new AppError("forbidden", m, 403);
export const notFound = (m = "not found") => new AppError("not_found", m, 404);
export const conflict = (m: string) => new AppError("conflict", m, 409);
export const tooMany = (m = "too many requests") => new AppError("rate_limited", m, 429);
/** Not implemented / capability not wired up (e.g. BACKUP_SCRIPT_PATH unset). */
export const notConfigured = (m: string, d?: unknown) => new AppError("not_configured", m, 501, d);

export function setErrorHandler(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({
      ok: false,
      error: { code: "validation_error", message: "invalid input", details: err.flatten() },
    });
  }
  const any = err as { statusCode?: number; message?: string; code?: string };
  if (any?.statusCode === 429) {
    return reply.status(429).send({ ok: false, error: { code: "rate_limited", message: "too many requests" } });
  }
  // Prisma known errors → clean JSON
  const prismaErr = err as { code?: string };
  if (prismaErr?.code === "P2002") {
    return reply.status(409).send({ ok: false, error: { code: "conflict", message: "duplicate value" } });
  }
  if (prismaErr?.code === "P2025") {
    return reply.status(404).send({ ok: false, error: { code: "not_found", message: "not found" } });
  }
  req(reply).log.error({ err }, "unhandled error");
  return reply.status(500).send({ ok: false, error: { code: "internal", message: "internal server error" } });
}

function req(reply: FastifyReply) {
  return reply.request;
}
