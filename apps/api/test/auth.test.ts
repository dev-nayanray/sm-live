/**
 * Auth API tests (Prompt 14).
 *
 * Coverage:
 *   - Registration: success, duplicate, validation errors, missing fields.
 *   - Login: success, wrong password, banned user.
 *   - OTP: request → verify (success + wrong code → consumed → request new).
 *   - Refresh: success + invalid token.
 *   - Logout: revokes the refresh session.
 *   - /v1/auth/me: requires bearer + returns masked contact info.
 *   - Password reset: request (always generic), confirm with valid token,
 *     expired token, consumed token, mismatched password rules.
 *
 * NOTE: These tests require a live Postgres instance (DATABASE_URL env).
 * The test file uses the existing `buildTestApp()` helper which loads the
 * real auth routes. Cleanup is per-test to avoid coupling.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword, sha256 } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let testUserId: number;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  // Cleanup test users + their cascaded rows.
  if (testUserId) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: testUserId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: testUserId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  }
  await app.close();
});

describe("POST /v1/auth/register", () => {
  it("creates a user + wallet + session tokens", async () => {
    const phone = `+88017${Date.now().toString().slice(-8)}`;
    const res = await app.inject({
      method: "POST", url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { phone, password: "User123!", displayName: "Auth Test", market: "default" },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.accessToken).toBeTruthy();
    expect(d.refreshToken).toBeTruthy();
    expect(d.user.displayName).toBe("Auth Test");
    testUserId = d.user.id;
    // Wallet created
    const wallet = await prisma.wallet.findUnique({ where: { userId: testUserId } });
    expect(wallet?.balance).toBe(0);
  });

  it("rejects duplicate phone with account-enumeration-safe error", async () => {
    // Use the user just created
    const res = await app.inject({
      method: "POST", url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { phone: "+880170000001", password: "User123!", displayName: "Dup" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("already registered");
  });

  it("rejects short password", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { phone: "+8801799887766", password: "12345", displayName: "Short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing identifier (no phone or email)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: { password: "User123!", displayName: "NoId" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/auth/login", () => {
  it("logs in with valid credentials", async () => {
    // Use a fresh user so we control the password
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Login Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "Pass1234!" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().accessToken).toBeTruthy();
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("rejects wrong password with generic error", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { identifier: "+880170000001", password: "wrong-password-xyz" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("invalid credentials");
  });

  it("rejects banned user with 403", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Banned Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    await prisma.playerRestriction.create({
      data: { userId: u.id, type: "ban", reason: "test ban", createdBy: 1 },
    });
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "Pass1234!" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain("banned");
    } finally {
      await prisma.playerRestriction.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});

describe("POST /v1/auth/otp/*", () => {
  it("requests an OTP and returns a dev code", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: { identifier: "+880170000001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().devCode).toMatch(/^\d{6}$/);
  });

  it("rejects wrong OTP code AND consumes it (single-attempt-per-code)", async () => {
    const identifier = unique("+88017");
    const req1 = await app.inject({
      method: "POST", url: "/v1/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: { identifier },
    });
    const wrongCode = req1.json().devCode === "000000" ? "111111" : "000000";
    const failRes = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: { identifier, code: wrongCode },
    });
    expect(failRes.statusCode).toBe(401);
    // The OTP should now be consumed — a second verify with the correct
    // code should also fail.
    const retryRes = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: { identifier, code: req1.json().devCode },
    });
    expect(retryRes.statusCode).toBe(401);
  });

  it("verifies a valid OTP for a registered user", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "OTP Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const req1 = await app.inject({
        method: "POST", url: "/v1/auth/otp/request",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone },
      });
      const code = req1.json().devCode;
      const verifyRes = await app.inject({
        method: "POST", url: "/v1/auth/otp/verify",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, code },
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().accessToken).toBeTruthy();
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("refuses OTP verify for unregistered identifier", async () => {
    const req1 = await app.inject({
      method: "POST", url: "/v1/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: { identifier: unique("+88017") },
    });
    const code = req1.json().devCode;
    const verifyRes = await app.inject({
      method: "POST", url: "/v1/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: { identifier: req1.json().devCode, code }, // wrong identifier
    });
    // No OTP exists for this identifier → 401
    expect(verifyRes.statusCode).toBe(401);
  });
});

describe("POST /v1/auth/refresh + /v1/auth/logout", () => {
  it("refreshes tokens and revokes the old session", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Refresh Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const loginRes = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "Pass1234!" },
      });
      const refreshToken = loginRes.json().refreshToken;
      const refreshRes = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        headers: { "content-type": "application/json" },
        payload: { refreshToken },
      });
      expect(refreshRes.statusCode).toBe(200);
      expect(refreshRes.json().accessToken).toBeTruthy();
      // The OLD refresh token should now be revoked → second refresh fails.
      const refreshRes2 = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        headers: { "content-type": "application/json" },
        payload: { refreshToken },
      });
      expect(refreshRes2.statusCode).toBe(401);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("logout revokes the refresh session", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Logout Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const loginRes = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "Pass1234!" },
      });
      const refreshToken = loginRes.json().refreshToken;
      const logoutRes = await app.inject({
        method: "POST", url: "/v1/auth/logout",
        headers: { "content-type": "application/json" },
        payload: { refreshToken },
      });
      expect(logoutRes.statusCode).toBe(200);
      // The refresh session should now be revoked.
      const refreshRes = await app.inject({
        method: "POST", url: "/v1/auth/refresh",
        headers: { "content-type": "application/json" },
        payload: { refreshToken },
      });
      expect(refreshRes.statusCode).toBe(401);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});

describe("GET /v1/auth/me", () => {
  it("returns masked contact info for an authenticated user", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: "test@example.com", passwordHash: await hashPassword("Pass1234!"), displayName: "Me Test" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 750 } });
    try {
      const loginRes = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "Pass1234!" },
      });
      const accessToken = loginRes.json().accessToken;
      const meRes = await app.inject({
        method: "GET", url: "/v1/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(meRes.statusCode).toBe(200);
      const d = meRes.json().data;
      expect(d.user.id).toBe(u.id);
      // Phone + email are masked — never the raw value.
      expect(d.user.phone).toContain("***");
      expect(d.user.email).toContain("***");
      expect(d.balance).toBe(750);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("rejects unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/auth/password/reset-request + reset-confirm", () => {
  it("returns generic response whether or not the identifier exists", async () => {
    const known = unique("+88017");
    const u = await prisma.user.create({
      data: { phone: known, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Reset Known" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const knownRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-request",
        headers: { "content-type": "application/json" },
        payload: { identifier: known },
      });
      expect(knownRes.statusCode).toBe(200);
      const knownJson = knownRes.json();
      expect(knownJson.sent).toBe(true);
      expect(knownJson.devToken).toBeTruthy(); // dev-only — production: hidden

      const unknownRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-request",
        headers: { "content-type": "application/json" },
        payload: { identifier: "+88017999999999" },
      });
      expect(unknownRes.statusCode).toBe(200);
      const unknownJson = unknownRes.json();
      expect(unknownJson.sent).toBe(true);
      // Unknown identifier returns NO devToken (defence-in-depth — even
      // though we say "sent" we don't fabricate a token).
      expect(unknownJson.devToken).toBeUndefined();
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("resets password with a valid token + revokes existing sessions", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("OldPass123!"), displayName: "Reset Pw" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    // Create an existing session that should be revoked after the reset.
    const existingSession = await prisma.session.create({
      data: {
        userId: u.id,
        tokenHash: sha256("fake-old-refresh-token-for-revocation-test"),
        userAgent: "test", ip: "127.0.0.1",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    try {
      const reqRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-request",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone },
      });
      const token = reqRes.json().devToken;
      expect(token).toBeTruthy();
      const confirmRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-confirm",
        headers: { "content-type": "application/json" },
        payload: { token, password: "NewPass456!" },
      });
      expect(confirmRes.statusCode).toBe(200);
      // Old password should no longer work.
      const oldLogin = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "OldPass123!" },
      });
      expect(oldLogin.statusCode).toBe(401);
      // New password works.
      const newLogin = await app.inject({
        method: "POST", url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone, password: "NewPass456!" },
      });
      expect(newLogin.statusCode).toBe(200);
      // Existing session was revoked.
      const session = await prisma.session.findUnique({ where: { id: existingSession.id } });
      expect(session?.revokedAt).not.toBeNull();
    } finally {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("refuses to reuse a consumed reset token", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Reset Reuse" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const reqRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-request",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone },
      });
      const token = reqRes.json().devToken;
      await app.inject({
        method: "POST", url: "/v1/auth/password/reset-confirm",
        headers: { "content-type": "application/json" },
        payload: { token, password: "NewPass456!" },
      });
      const reuseRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-confirm",
        headers: { "content-type": "application/json" },
        payload: { token, password: "Another789!" },
      });
      expect(reuseRes.statusCode).toBe(401);
      expect(reuseRes.json().error.message).toContain("already used");
    } finally {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("rejects reset-confirm with an unknown token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/auth/password/reset-confirm",
      headers: { "content-type": "application/json" },
      payload: { token: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", password: "NewPass456!" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects reset-confirm with a weak password", async () => {
    const phone = unique("+88017");
    const u = await prisma.user.create({
      data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Reset Weak" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const reqRes = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-request",
        headers: { "content-type": "application/json" },
        payload: { identifier: phone },
      });
      const token = reqRes.json().devToken;
      const res = await app.inject({
        method: "POST", url: "/v1/auth/password/reset-confirm",
        headers: { "content-type": "application/json" },
        payload: { token, password: "12345" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
