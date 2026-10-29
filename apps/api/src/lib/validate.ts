import type { FastifyRequest } from "fastify";
import type { ZodTypeAny } from "zod";
import { AppError } from "./errors.js";

export function validate<T extends ZodTypeAny>(schema: T, data: unknown): ReturnType<T["parse"]> {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new AppError("validation_error", "invalid input", 400, res.error.flatten());
  }
  return res.data as ReturnType<T["parse"]>;
}

export const bodyOf = (req: FastifyRequest) => req.body ?? {};
export const queryOf = (req: FastifyRequest) => ({ ...(req.query as Record<string, string | undefined>) });
export const paramsOf = (req: FastifyRequest) => ({ ...(req.params as Record<string, string | undefined>) });
