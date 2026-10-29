import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import { env } from "../env.js";
import { prisma } from "./prisma.js";
import { unauthorized, forbidden } from "./errors.js";
import type { Permission } from "@sm-live/shared";
import type { AdminUser, Role, User, Wallet } from "@prisma/client";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export interface UserTokenPayload {
  sub: number;
  kind: "user";
  market: string;
}

export interface AdminTokenPayload {
  sub: number;
  kind: "admin";
  role: string;
}

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) throw unauthorized("missing bearer token");
  return h.slice(7);
}

// --- User auth ------------------------------------------------------------
export function signUserToken(payload: UserTokenPayload): string {
  return jwtSign(payload as unknown as Record<string, unknown>, env.JWT_SECRET, env.NODE_ENV === "test" ? "1h" : "15m");
}
export function signAdminToken(payload: AdminTokenPayload): string {
  return jwtSign(payload as unknown as Record<string, unknown>, env.ADMIN_JWT_SECRET, "1h");
}

function b64u(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function jwtSign(payload: Record<string, unknown>, secret: string, expires: string): string {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds(expires) }));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function jwtVerify<T>(token: string, secret: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorized("malformed token");
  const [h, b, s] = parts as [string, string, string];
  const expect = crypto.createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url");
  const a = Buffer.from(s);
  const e = Buffer.from(expect);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) throw unauthorized("bad signature");
  const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as { exp?: number };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw unauthorized("token expired");
  return payload as T;
}

function ttlSeconds(expr: string): number {
  const m = /^(\d+)([smhd])$/.exec(expr);
  if (!m) return 900;
  const n = Number(m[1]);
  return m[2] === "s" ? n : m[2] === "m" ? n * 60 : m[2] === "h" ? n * 3600 : n * 86400;
}

export interface AuthedUser {
  user: User & { wallet: Wallet | null };
}

export async function requireUser(req: FastifyRequest): Promise<AuthedUser> {
  const payload = jwtVerify<UserTokenPayload>(bearer(req), env.JWT_SECRET);
  if (payload.kind !== "user") throw unauthorized("wrong token kind");
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { wallet: true },
  });
  if (!user) throw unauthorized("user not found");
  const ban = await prisma.playerRestriction.findFirst({
    where: { userId: user.id, type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  if (ban) throw forbidden("account banned");
  return { user };
}

// --- Admin auth -----------------------------------------------------------
type AdminWithPerms = AdminUser & { role: Role & { permissions: { permission: { key: string } }[] } };

export async function requireAdmin(req: FastifyRequest, perm?: Permission): Promise<AdminWithPerms> {
  const payload = jwtVerify<AdminTokenPayload>(bearer(req), env.ADMIN_JWT_SECRET);
  if (payload.kind !== "admin") throw unauthorized("wrong token kind");
  const admin = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!admin || !admin.active) throw unauthorized("admin not found or inactive");
  if (perm) {
    const keys = new Set(admin.role.permissions.map((p) => p.permission.key));
    if (!keys.has(perm)) throw forbidden(`missing permission: ${perm}`);
  }
  return admin;
}

// --- Refresh tokens -------------------------------------------------------
export async function issueSessionTokens(userId: number, req: FastifyRequest) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  const accessToken = signUserToken({ sub: userId, kind: "user", market: user.marketCode });
  const refreshToken = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200),
      ip: req.ip,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });
  return { accessToken, refreshToken, user: publicUser(user) };
}

export function publicUser(u: User) {
  return {
    id: u.id,
    phone: u.phone ? mask(u.phone) : null,
    email: u.email ? mask(u.email) : null,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    marketCode: u.marketCode,
    country: u.country,
    vipLevel: u.vipLevel,
    nobleLevel: u.nobleLevel,
    createdAt: u.createdAt,
  };
}

function mask(s: string) {
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "***" + s.slice(-2);
}
