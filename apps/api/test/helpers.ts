import Fastify, { type FastifyInstance } from "fastify";
import { providerRoutes } from "../src/routes/provider.js";
import { adminResourceRoutes } from "../src/routes/admin/resources.js";
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
  await app.ready();
  return app;
}
