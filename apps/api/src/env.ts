import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

// minimal .env loader (no dependency) — real env vars always win
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  LIVEKIT_URL: z.string().default("ws://localhost:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("devsecret_that_is_at_least_16_chars"),
  JWT_SECRET: z.string().min(16).default("dev-jwt-secret-not-for-production"),
  ADMIN_JWT_SECRET: z.string().min(16).default("dev-admin-jwt-secret-not-for-prod"),
  SUPER_ADMIN_USERNAME: z.string().default("superadmin"),
  SUPER_ADMIN_PASSWORD: z.string().default("SuperAdmin123!"),
  SUPER_ADMIN_EMAIL: z.string().default("admin@sm-live.local"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  PUBLIC_API_BASE: z.string().default("http://localhost:4000"),
  PAYMENT_ADAPTER: z.enum(["fake"]).default("fake"),
});

export const env = envSchema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
