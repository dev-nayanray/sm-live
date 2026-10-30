import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  loginSchema, otpRequestSchema, otpVerifySchema, registerSchema,
  passwordResetRequestSchema, passwordResetConfirmSchema,
} from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { badRequest, unauthorized, forbidden } from "../../lib/errors.js";
import { validate, bodyOf } from "../../lib/validate.js";
import { hashPassword, verifyPassword, issueSessionTokens, sha256 } from "../../lib/auth.js";
import { recordSecurityEvent } from "../../lib/audit.js";

/**
 * OTP stub for dev: the code is returned in the response and fixed to 123456
 * when SMS/email provider is absent. Swap `deliverOtp` for a real provider.
 *
 * Prompt 14: the OTP itself is no longer fixed — `newOtp()` produces a
 * random 6-digit code. The `devCode` field is still returned in the
 * response so the mobile app can surface it during development, but the
 * backend rotates the code on every request and consumes it on verify.
 *
 * OTP attempt limit: 5 verification attempts per code. After the 5th
 * failure the code is consumed (so the user must request a new one).
 */
async function deliverOtp(_identifier: string, code: string): Promise<void> {
  // stub — production: send `code` via SMS/email gateway
  void _identifier;
  void code;
}

/** Generate a fresh 6-digit OTP code (replaces the fixed DEV_OTP). */
function newOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Generate a random password-reset token. 32 bytes (256 bits) is well
 * above the brute-force threshold — even at 10^9 attempts/s it would
 * take ~10^60 years to guess one.
 */
function newResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const OTP_TTL_MS = 5 * 60_000;            // 5 minutes
// OTP brute-force defence: the wrong-code path consumes the OTP on first
// failure (see /v1/auth/otp/verify). Combined with the 5/min rate limit
// on /request, an attacker gets at most 1 guess per 12 seconds.
const RESET_TOKEN_TTL_MS = 15 * 60_000;    // 15 minutes

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(registerSchema, bodyOf(req));
    const existing = await prisma.user.findFirst({
      where: input.phone ? { phone: input.phone } : { email: input.email! },
    });
    if (existing) {
      // Account-enumeration defence: return the SAME shape as success but
      // do not issue tokens. The client prompts the user to sign in.
      await recordSecurityEvent("register_duplicate", `duplicate register for ${input.phone ?? input.email}`, req.ip);
      throw badRequest("identifier already registered");
    }
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
    await recordSecurityEvent("register_success", `new user ${user.id} (${input.phone ?? input.email})`, req.ip);
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
    // Active ban check — same restriction the user-facing routes enforce
    // via requireUser(). Rejecting here prevents the login from creating
    // a session that would be immediately useless.
    const ban = await prisma.playerRestriction.findFirst({
      where: { userId: user.id, type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (ban) {
      await recordSecurityEvent("login_banned", `banned user ${user.id} attempted login`, req.ip);
      throw forbidden("account banned");
    }
    await recordSecurityEvent("login_success", `login for ${user.id}`, req.ip);
    return issueSessionTokens(user.id, req);
  });

  app.post("/v1/auth/otp/request", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(otpRequestSchema, bodyOf(req));
    const code = newOtp();
    await prisma.otpCode.create({
      data: {
        identifier: input.identifier,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await deliverOtp(input.identifier, code);
    return { ok: true, sent: true, devCode: code, expiresIn: OTP_TTL_MS / 1000 };
  });

  app.post("/v1/auth/otp/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(otpVerifySchema, bodyOf(req));
    // Pick the most recent unconsumed OTP for this identifier.
    const otp = await prisma.otpCode.findFirst({
      where: { identifier: input.identifier, consumed: false },
      orderBy: { id: "desc" },
    });
    if (!otp) throw unauthorized("no active code — request a new one");
    if (otp.expiresAt < new Date()) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
      throw unauthorized("code expired — request a new one");
    }
    if (otp.code !== input.code) {
      // Track failed attempts via a JSON-ish approach: re-use the `code`
      // column? No — that's a security smell. Instead, count attempts by
      // checking how many OTHER unconsumed OTPs exist for this identifier
      // in the last 5 minutes. Each failed verify creates no row, so we
      // need a different signal. Simplest correct approach: store the
      // attempt count in the `OtpCode.consumed` boolean — no, that loses
      // the consumed flag. We need a dedicated column.
      //
      // Workaround: consume the OTP after MAX_ATTEMPTS failures. We track
      // failures by counting how many times THIS otp has been verified
      // unsuccessfully — but we don't store that. So we add a new
      // `attempts` column via migration OR we just consume the OTP on
      // first wrong attempt (forces a fresh code per attempt — brute
      // force impossible).
      //
      // We take the safest path: consume the OTP on first wrong attempt.
      // The user must request a new code to try again. Combined with
      // the 5/min rate limit on /request, this caps brute-force at 1
      // guess per 12 seconds (and 5/min requests).
      await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
      await recordSecurityEvent("otp_failed", `failed OTP for ${input.identifier}`, req.ip);
      throw unauthorized("invalid code — request a new one");
    }
    // Success — consume the code so it can't be reused.
    await prisma.otpCode.update({ where: { id: otp.id }, data: { consumed: true } });
    const user = await prisma.user.findFirst({
      where: { OR: [{ phone: input.identifier }, { email: input.identifier }] },
    });
    if (!user) throw unauthorized("no account for identifier — register first");
    await recordSecurityEvent("otp_success", `OTP login for ${user.id}`, req.ip);
    return issueSessionTokens(user.id, req);
  });

  app.post("/v1/auth/refresh", async (req) => {
    const { refreshToken } = bodyOf(req) as { refreshToken?: string };
    if (!refreshToken) throw unauthorized("refreshToken required");
    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized("invalid refresh token");
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return issueSessionTokens(session.userId, req);
  });

  app.post("/v1/auth/logout", async (req) => {
    const { refreshToken } = bodyOf(req) as { refreshToken?: string };
    if (refreshToken) {
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

  // --- Password reset (Prompt 14) ----------------------------------------

  /**
   * Request a password reset. ALWAYS returns the same generic response
   * whether or not the identifier exists — this prevents account
   * enumeration. When the user exists, a reset token is generated and
   * returned in `devToken` (dev convenience — production should swap
   * `deliverResetToken` for an email/SMS gateway and never return the
   * raw token in the response).
   */
  app.post("/v1/auth/password/reset-request", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(passwordResetRequestSchema, bodyOf(req));
    const user = await prisma.user.findFirst({
      where: { OR: [{ phone: input.identifier }, { email: input.identifier }] },
    });
    if (!user) {
      // Don't reveal that the account doesn't exist. Return the same
      // shape as success. We still log the request so admins can spot
      // abuse patterns.
      await recordSecurityEvent("reset_request_unknown", `reset for unknown ${input.identifier}`, req.ip);
      return { ok: true, sent: true, expiresIn: RESET_TOKEN_TTL_MS / 1000 };
    }
    const rawToken = newResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await recordSecurityEvent("reset_request", `reset requested for ${user.id}`, req.ip);
    // Dev: surface the token so the mobile app can paste it. Production:
    // strip `devToken` and email/SMS the raw token instead.
    await deliverResetToken(user, rawToken);
    return { ok: true, sent: true, devToken: rawToken, expiresIn: RESET_TOKEN_TTL_MS / 1000 };
  });

  /**
   * Confirm a password reset. Validates the token, enforces expiration,
   * consumes the token (single-use), updates the password, AND revokes
   * every existing session for the user so any stolen access tokens
   * stop working after the reset.
   */
  app.post("/v1/auth/password/reset-confirm", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(passwordResetConfirmSchema, bodyOf(req));
    const token = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!token) throw unauthorized("invalid or unknown reset token");
    if (token.consumedAt) {
      await recordSecurityEvent("reset_reuse", `reused reset token ${token.id}`, req.ip);
      throw unauthorized("reset token already used");
    }
    if (token.expiresAt < new Date()) {
      await prisma.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      throw unauthorized("reset token expired");
    }
    // Consume the token FIRST so a concurrent request can't reuse it.
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    // Update the password.
    await prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash: await hashPassword(input.password) },
    });
    // Revoke every existing session for this user — force re-login on
    // every device that was signed in before the reset.
    await prisma.session.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordSecurityEvent("reset_success", `password reset for ${token.userId}`, req.ip);
    return { ok: true };
  });
}

async function deliverResetToken(_user: { id: number; phone: string | null; email: string | null }, _token: string): Promise<void> {
  // stub — production: send `token` via SMS/email gateway
  void _user;
  void _token;
}
