import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "up";
    } catch {
      checks.database = "down";
      ok = false;
    }
    try {
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "up" : "down";
      if (pong !== "PONG") ok = false;
    } catch {
      checks.redis = "down";
      ok = false;
    }
    return { ok, service: "sm-live-api", version: process.env.npm_package_version ?? "0.1.0", checks, time: new Date().toISOString() };
  });
}
