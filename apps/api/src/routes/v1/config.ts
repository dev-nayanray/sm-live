import type { FastifyInstance } from "fastify";
import { configService } from "../../services/config.service.js";
import { requireUser } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";

/** Public app config — drives the mobile app entirely (brand, tabs, games, gifts, flags). */
export async function configRoutes(app: FastifyInstance) {
  app.get("/v1/config/app", async (req) => {
    let market = (req.query as { market?: string }).market;
    if (!market) {
      // fall back to the calling user's market if a token is supplied
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          const { user } = await requireUser(req);
          market = user.marketCode;
        } catch {
          /* anonymous */
        }
      }
    }
    const code = market ?? "default";
    const cfg = await configService.getAppConfig(code);
    const m = await prisma.market.findUnique({ where: { code } });
    return { ok: true, data: { ...cfg, market: m?.code ?? cfg.market, realMoneyEnabled: m?.realMoneyEnabled ?? false } };
  });
}
