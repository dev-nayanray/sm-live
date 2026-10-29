import type { PrismaClient } from "@prisma/client";
import type { AppConfigGame, AppConfigGift, AppConfigResponse, AppConfigTab } from "@sm-live/shared";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";

const CACHE_PREFIX = "sm-live:config:app:";
const CACHE_TTL_SECONDS = 60;

/**
 * Every business value (brand, flags, games, bet limits, gifts, tabs) is read
 * from the database through this service. Redis caches the assembled payload;
 * admin mutations call invalidateConfig() so changes appear within a request.
 */
export class ConfigService {
  constructor(private db: PrismaClient = prisma) {}

  async getAppConfig(marketCode: string): Promise<AppConfigResponse> {
    const cacheKey = CACHE_PREFIX + marketCode;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as AppConfigResponse;
    } catch {
      /* cache miss on redis outage is acceptable */
    }
    const fresh = await this.buildAppConfig(marketCode);
    try {
      await redis.set(cacheKey, JSON.stringify(fresh), "EX", CACHE_TTL_SECONDS);
    } catch {
      /* ignore */
    }
    return fresh;
  }

  async invalidateConfig(marketCode?: string): Promise<void> {
    try {
      if (marketCode) {
        await redis.del(CACHE_PREFIX + marketCode);
      } else {
        const keys = await redis.keys(CACHE_PREFIX + "*");
        if (keys.length > 0) await redis.del(...keys);
      }
    } catch {
      /* ignore */
    }
  }

  async getSettingsMap(): Promise<Record<string, string>> {
    const rows = await this.db.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async getFlag(key: string): Promise<boolean> {
    const f = await this.db.featureFlag.findUnique({ where: { key } });
    return f?.enabled ?? false;
  }

  private async buildAppConfig(marketCode: string): Promise<AppConfigResponse> {
    const [market] = await this.db.market.findMany({ where: { code: marketCode, enabled: true }, take: 1 });
    const effectiveMarket = market ?? (await this.db.market.findFirst({ where: { code: "default" } }));
    const [brand, flags, gifts, games, countryFilters] = await Promise.all([
      effectiveMarket
        ? this.db.brandConfig.findUnique({ where: { marketId: effectiveMarket.id } })
        : Promise.resolve(null),
      this.db.featureFlag.findMany(),
      this.db.gift.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }),
      effectiveMarket
        ? this.db.game.findMany({
            where: { status: { not: "disabled" }, configs: { some: { marketId: effectiveMarket.id } } },
            include: { configs: { where: { marketId: effectiveMarket.id } } },
            orderBy: { sortOrder: "asc" },
          })
        : Promise.resolve([]),
      effectiveMarket ? this.db.countryFilter.findMany({ where: { marketId: effectiveMarket.id } }) : Promise.resolve([]),
    ]);

    const appGames: AppConfigGame[] = games.map((g) => {
      const cfg = g.configs[0];
      return {
        code: g.code,
        name: g.name,
        thumbnailUrl: g.thumbnailUrl,
        isPro: g.isPro,
        status: g.status,
        minBet: cfg?.minBet ?? 1,
        maxBet: cfg?.maxBet ?? 10000,
      };
    });

    const appGifts: AppConfigGift[] = gifts.map((g) => ({
      id: g.id,
      name: g.name,
      iconUrl: g.iconUrl,
      price: g.price,
      category: g.category,
      animation: g.animation,
    }));

    const tabs = (brand?.bottomTabs ?? []) as unknown as AppConfigTab[];

    return {
      brand: {
        appName: brand?.appName ?? "SM Live",
        logoUrl: brand?.logoUrl ?? "",
        primaryColor: brand?.primaryColor ?? "#7c3aed",
        accentColor: brand?.accentColor ?? "#f43f5e",
      },
      flags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
      games: appGames,
      gifts: appGifts,
      bottomTabs: tabs,
      market: effectiveMarket?.code ?? "default",
      realMoneyEnabled: effectiveMarket?.realMoneyEnabled ?? false,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Country filter check used by room listing / registration. */
  async isCountryBlocked(marketCode: string, country: string): Promise<boolean> {
    const m = await this.db.market.findUnique({ where: { code: marketCode } });
    if (!m) return false;
    const f = await this.db.countryFilter.findUnique({
      where: { marketId_country: { marketId: m.id, country: country.toUpperCase() } },
    });
    return f?.blocked ?? false;
  }
}

export const configService = new ConfigService();
