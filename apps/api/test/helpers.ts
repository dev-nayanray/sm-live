import Fastify, { type FastifyInstance } from "fastify";
import { providerRoutes } from "../src/routes/provider.js";
import { adminResourceRoutes } from "../src/routes/admin/resources.js";
import { adminRoutes } from "../src/routes/admin/index.js";
import { authRoutes } from "../src/routes/v1/auth.js";
import { walletRoutes } from "../src/routes/v1/wallet.js";
import { feedRoutes } from "../src/routes/v1/feed.js";
import { messageRoutes } from "../src/routes/v1/messages.js";
import { socialRoutes } from "../src/routes/v1/social.js";
import { vipRoutes } from "../src/routes/v1/vip.js";
import { notificationRoutes } from "../src/routes/v1/notifications.js";
import { setErrorHandler } from "../src/lib/errors.js";

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addContentTypeParser<string>("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      (req as typeof req & { rawBody?: string }).rawBody = body;
      done(null, body.length ? JSON.parse(body) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });
  app.setErrorHandler((err, _req, reply) => setErrorHandler(reply, err));
  await app.register(providerRoutes);
  await app.register(adminResourceRoutes);
  await app.register(adminRoutes);
  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(feedRoutes);
  await app.register(messageRoutes);
  await app.register(socialRoutes);
  await app.register(vipRoutes);
  await app.register(notificationRoutes);
  await app.ready();
  return app;
}
