import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loginSchema, otpRequestSchema, otpVerifySchema, registerSchema } from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { badRequest, unauthorized } from "../../lib/errors.js";
import { validate, bodyOf } from "../../lib/validate.js";
import { hashPassword, verifyPassword, issueSessionTokens } from "../../lib/auth.js";
import { recordSecurityEvent } from "../../lib/audit.js";

/**
 * OTP stub for dev: the code is returned in the response and fixed to 123456
 * when SMS/email provider is absent. Swap `deliverOtp` for a real provider.
 */
const DEV_OTP = "123456";

async function deliverOtp(identifier: string): Promise<string> {
  return DEV_OTP; // stub — production: send via SMS/email gateway
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(registerSchema, bodyOf(req));
    const existing = await prisma.user.findFirst({
      where: input.phone ? { phone: input.phone } : { email: input.email! },
    });
    if (existing) throw badRequest("identifier already registered");
    const user = await prisma.user.create({
      data: {
        phone: input.phone ?? null,
        email: input.email ?? null,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        marketCode: input.market,
        referrerCode: input.referrerCode ?? null,
      },
    });
    await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
    return issueSessionTokens(user.id, req);
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(loginSchema, bodyOf(req));
    const user = await prisma.user.findFirst({
      where: { OR: [{ phone: input.identifier }, { email: input.identifier }] },
    });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      await recordSecurityEvent("login_failed", `failed login for ${input.identifier}`, req.ip);
      throw unauthorized("invalid credentials");
    }
    return issueSessionTokens(user.id, req);
  });

  app.post("/v1/auth/otp/request", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(otpRequestSchema, bodyOf(req));
    const code = await deliverOtp(input.identifier);
    await prisma.otpCode.create({
      data: { identifier: input.identifier, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    });
    return { ok: true, sent: true, devCode: code, expiresIn: 300 };
  });

  app.post("/v1/auth/otp/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(otpVerifySchema, bodyOf(req));
    const otp = await prisma.otpCode.findFirst({
      where: { identifier: input.identifier, code: input.code, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { id: "desc" },
    });
    if (!otp) throw unauthorized("invalid or expired otp");
    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
    const user = await prisma.user.findFirst({
      where: { OR: [{ phone: input.identifier }, { email: input.identifier }] },
    });
    if (!user) throw unauthorized("no account for identifier — register first");
    return issueSessionTokens(user.id, req);
  });

  app.post("/v1/auth/refresh", async (req) => {
    const { refreshToken } = bodyOf(req) as { refreshToken?: string };
    if (!refreshToken) throw unauthorized("refreshToken required");
    const { sha256 } = await import("../../lib/auth.js");
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized("invalid refresh token");
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return issueSessionTokens(session.userId, req);
  });

  app.post("/v1/auth/logout", async (req) => {
    const { refreshToken } = bodyOf(req) as { refreshToken?: string };
    if (refreshToken) {
      const { sha256 } = await import("../../lib/auth.js");
      await prisma.session.updateMany({
        where: { tokenHash: sha256(refreshToken) },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  });

  app.get("/v1/auth/me", async (req) => {
    const { requireUser } = await import("../../lib/auth.js");
    const { user } = await requireUser(req);
    const { publicUser } = await import("../../lib/auth.js");
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    return { user: publicUser(user), balance: wallet?.balance ?? 0 };
  });
}

export function newOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}
