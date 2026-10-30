import crypto from "node:crypto";
import Fastify from "fastify";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { setErrorHandler } from "./lib/errors.js";
import { httpRequestCounter, httpRequestDuration, metricsText } from "./lib/metrics.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/v1/auth.js";
import { configRoutes } from "./routes/v1/config.js";
import { roomRoutes } from "./routes/v1/rooms.js";
import { giftRoutes } from "./routes/v1/gifts.js";
import { walletRoutes } from "./routes/v1/wallet.js";
import { agencyRoutes } from "./routes/v1/agencies.js";
import { gameRoutes } from "./routes/v1/games.js";
import { contentRoutes } from "./routes/v1/content.js";
import { feedRoutes } from "./routes/v1/feed.js";
import { adminRoutes } from "./routes/admin/index.js";
import { adminResourceRoutes } from "./routes/admin/resources.js";
import { providerRoutes } from "./routes/provider.js";
import { initSocket } from "./socket.js";
import { startScheduler } from "./workers/scheduler.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";

async function main() {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
  });

  // capture raw body for HMAC verification before JSON parsing
  app.addContentTypeParser<string>("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      (req as typeof req & { rawBody?: string }).rawBody = body;
      done(null, body.length ? JSON.parse(body) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  await app.register(import("@fastify/helmet"), { contentSecurityPolicy: false });
  await app.register(import("@fastify/cors"), {
    origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });
  await app.register(import("@fastify/rate-limit"), {
    global: false,
    max: 300,
    timeWindow: "1 minute",
    redis: env.NODE_ENV === "test" ? undefined : (await import("./lib/redis.js")).redis,
  });

  // metrics + request timing
  app.addHook("onRequest", async (req) => {
    (req as unknown as { start: bigint }).start = process.hrtime.bigint();
  });
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? "unmatched";
    const labels = { method: req.method, route, status: reply.statusCode };
    httpRequestCounter.inc(labels);
    const start = (req as unknown as { start?: bigint }).start;
    if (start) httpRequestDuration.observe({ method: req.method, route }, Number(process.hrtime.bigint() - start) / 1e9);
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return metricsText();
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ ok: false, error: { code: "not_found", message: "route not found" } })
  );
  app.setErrorHandler((err, _req, reply) => setErrorHandler(reply, err));

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(configRoutes);
  await app.register(roomRoutes);
  await app.register(giftRoutes);
  await app.register(walletRoutes);
  await app.register(agencyRoutes);
  await app.register(gameRoutes);
  await app.register(contentRoutes);
  await app.register(feedRoutes);
  await app.register(adminRoutes);
  await app.register(adminResourceRoutes);
  await app.register(providerRoutes);

  await app.ready();
  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`api listening on ${address}`);

  initSocket(app.server);
  const scheduler = env.NODE_ENV === "test" ? null : startScheduler();

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "graceful shutdown");
    if (scheduler) await scheduler.shutdown();
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.error({ err: e }, "fatal startup error");
  process.exit(1);
});
