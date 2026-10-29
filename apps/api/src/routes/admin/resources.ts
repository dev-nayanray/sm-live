import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ZodTypeAny, z } from "zod";
import {
  giftSchema, gameSchema, gameProviderSchema, gameConfigSchema, marketSchema, brandConfigSchema,
  featureFlagSchema, countryFilterSchema, settingSchema, apiAccessKeySchema, playerRestrictionSchema,
  paginationQuery,
} from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError, notFound, badRequest } from "../../lib/errors.js";
import { validate } from "../../lib/validate.js";
import { requireAdmin } from "../../lib/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { configService } from "../../services/config.service.js";

type AnyDelegate = {
  findMany(args: never): Promise<Record<string, unknown>[]>;
  findUnique(args: { where: { id: number } }): Promise<Record<string, unknown> | null>;
  create(args: { data: unknown }): Promise<Record<string, unknown>>;
  update(args: { where: { id: number }; data: unknown }): Promise<Record<string, unknown>>;
  delete(args: { where: { id: number } }): Promise<Record<string, unknown>>;
  count(args: never): Promise<number>;
};

export interface ResourceDef {
  label: string;
  model: keyof PrismaClient;
  schema: ZodTypeAny;
  searchFields: string[];
  sortFields: string[];
  readPerm: string;
  writePerm: string;
  include?: Record<string, unknown>;
  /** config-driven entities invalidate the app-config cache when mutated */
  invalidatesConfig?: boolean;
}

export const RESOURCES: Record<string, ResourceDef> = {
  gifts: { label: "Gifts", model: "gift", schema: giftSchema, searchFields: ["name", "category"], sortFields: ["id", "name", "price", "sortOrder"], readPerm: "rooms.read", writePerm: "rooms.write", invalidatesConfig: true },
  games: { label: "Games", model: "game", schema: gameSchema, searchFields: ["code", "name"], sortFields: ["id", "code", "name", "sortOrder"], readPerm: "games.read", writePerm: "games.write", include: { provider: { select: { id: true, name: true } }, configs: true }, invalidatesConfig: true },
  "game-providers": { label: "Game Providers", model: "gameProvider", schema: gameProviderSchema, searchFields: ["name", "code"], sortFields: ["id", "name"], readPerm: "providers.read", writePerm: "providers.write" },
  "game-configs": { label: "Game Configs", model: "gameConfig", schema: gameConfigSchema, searchFields: [], sortFields: ["id", "gameId", "marketId"], readPerm: "games.read", writePerm: "games.write", include: { game: { select: { id: true, name: true } }, market: { select: { id: true, code: true } } }, invalidatesConfig: true },
  markets: { label: "Markets", model: "market", schema: marketSchema, searchFields: ["code", "name"], sortFields: ["id", "code"], readPerm: "settings.read", writePerm: "settings.write", invalidatesConfig: true },
  "brand-configs": { label: "Brand Configs", model: "brandConfig", schema: brandConfigSchema, searchFields: ["appName"], sortFields: ["id"], readPerm: "settings.read", writePerm: "settings.write", invalidatesConfig: true },
  "feature-flags": { label: "Feature Flags", model: "featureFlag", schema: featureFlagSchema, searchFields: ["key", "description"], sortFields: ["id", "key"], readPerm: "settings.read", writePerm: "settings.write", invalidatesConfig: true },
  "country-filters": { label: "Country Filters", model: "countryFilter", schema: countryFilterSchema, searchFields: ["country"], sortFields: ["id", "country"], readPerm: "settings.read", writePerm: "settings.write", invalidatesConfig: true },
  settings: { label: "Settings", model: "setting", schema: settingSchema, searchFields: ["key", "value"], sortFields: ["key"], readPerm: "settings.read", writePerm: "settings.write", invalidatesConfig: true },
  "api-access-keys": { label: "API Access Keys", model: "apiAccessKey", schema: apiAccessKeySchema, searchFields: ["label", "key"], sortFields: ["id", "label"], readPerm: "security.read", writePerm: "security.write", include: { provider: { select: { id: true, name: true } } } },
  restrictions: { label: "Player Restrictions", model: "playerRestriction", schema: playerRestrictionSchema, searchFields: ["reason", "type"], sortFields: ["id", "createdAt", "type"], readPerm: "players.read", writePerm: "players.write", include: { user: { select: { id: true, displayName: true } } } },
};

function delegate(model: keyof PrismaClient): AnyDelegate {
  return (prisma as unknown as Record<string, AnyDelegate>)[model as string]!;
}

export function fieldDescriptors(schema: ZodTypeAny) {
  const shape = (schema as unknown as { _def: { shape?: () => Record<string, ZodTypeAny> } })._def.shape?.() ?? {};
  return Object.entries(shape).map(([name, t]) => {
    let type = "string";
    const def = (t as unknown as { _def: { typeName?: string; values?: readonly string[]; innerType?: unknown } })._def;
    const typeName = def.typeName;
    if (typeName === "ZodNumber" || typeName === "ZodBigInt") type = "number";
    else if (typeName === "ZodBoolean") type = "boolean";
    else if (typeName === "ZodEnum") type = "enum";
    else if (typeName === "ZodArray" || typeName === "ZodObject") type = "json";
    else if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
      // unwrap
      const inner = (def as { innerType?: { _def?: { typeName?: string; values?: readonly string[] } } }).innerType;
      if (inner?._def?.typeName === "ZodNumber") type = "number";
      else if (inner?._def?.typeName === "ZodBoolean") type = "boolean";
      else if (inner?._def?.typeName === "ZodEnum") type = "enum";
      else if (inner?._def?.typeName === "ZodDate") type = "date";
      else if (inner?._def?.typeName === "ZodArray" || inner?._def?.typeName === "ZodObject") type = "json";
      else type = "string?";
    }
    const values = typeName === "ZodEnum" ? def.values : type === "enum" ? ((def as { innerType?: { _def?: { values?: readonly string[] } } }).innerType?._def?.values ?? []) : [];
    const optional = typeName === "ZodOptional" || typeName === "ZodNullable";
    return { name, type, options: values as string[], optional };
  });
}

export async function adminResourceRoutes(app: FastifyInstance) {
  app.get("/v1/admin/resources", async (req) => {
    await requireAdmin(req);
    return {
      ok: true,
      data: Object.entries(RESOURCES).map(([key, r]) => ({
        key,
        label: r.label,
        fields: fieldDescriptors(r.schema),
        searchFields: r.searchFields,
        sortFields: r.sortFields,
      })),
    };
  });

  app.get("/v1/admin/resources/:resource", async (req) => {
    const { resource } = req.params as { resource: string };
    const def = RESOURCES[resource];
    if (!def) throw notFound(`unknown resource ${resource}`);
    await requireAdmin(req, def.readPerm as never);
    const q = validate(paginationQuery, { ...(req.query as Record<string, string>) });
    const where = q.search && def.searchFields.length > 0
      ? { OR: def.searchFields.map((f) => ({ [f]: { contains: q.search, mode: "insensitive" as const } })) }
      : {};
    const sortBy = q.sortBy && def.sortFields.includes(q.sortBy) ? q.sortBy : def.sortFields[0] ?? "id";
    const orderBy = { [sortBy]: q.sortDir };
    const model = def.model === "setting" ? prisma.setting : delegate(def.model);
    const [total, items] = await Promise.all([
      model.count(where as never),
      model.findMany({
        where: where as never,
        orderBy: orderBy as never,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        ...(def.include ? { include: def.include } : {}),
      } as never),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items: serialize(items) } };
  });

  app.get("/v1/admin/resources/:resource/:id", async (req) => {
    const { resource, id } = req.params as { resource: string; id: string };
    const def = RESOURCES[resource];
    if (!def) throw notFound(`unknown resource ${resource}`);
    await requireAdmin(req, def.readPerm as never);
    const item = await delegate(def.model).findUnique({ where: { id: Number(id) } } as never);
    if (!item) throw notFound();
    return { ok: true, data: serializeOne(item) };
  });

  app.post("/v1/admin/resources/:resource", async (req) => {
    const { resource } = req.params as { resource: string };
    const def = RESOURCES[resource];
    if (!def) throw notFound(`unknown resource ${resource}`);
    const admin = await requireAdmin(req, def.writePerm as never);
    const input = validate(def.schema, req.body);
    const item = await delegate(def.model).create({ data: enrich(resource, input) } as never);
    await writeAudit({ adminId: admin.id, req, action: "create", entity: resource, entityId: String(item.id ?? ""), after: item });
    if (def.invalidatesConfig) await configService.invalidateConfig();
    return { ok: true, data: serializeOne(item) };
  });

  app.patch("/v1/admin/resources/:resource/:id", async (req) => {
    const { resource, id } = req.params as { resource: string; id: string };
    const def = RESOURCES[resource];
    if (!def) throw notFound(`unknown resource ${resource}`);
    const admin = await requireAdmin(req, def.writePerm as never);
    const partial = (def.schema as z.ZodObject<Record<string, ZodTypeAny>>).partial();
    const input = validate(partial, req.body);
    const numId = resource === "settings" ? undefined : Number(id);
    if (Number.isNaN(numId) && resource !== "settings") throw badRequest("numeric id required");
    const before = resource === "settings"
      ? await prisma.setting.findUnique({ where: { key: id } })
      : await delegate(def.model).findUnique({ where: { id: numId! } } as never);
    if (!before) throw notFound();
    const item = resource === "settings"
      ? await prisma.setting.update({ where: { key: id }, data: input })
      : await delegate(def.model).update({ where: { id: numId! }, data: enrich(resource, input) } as never);
    await writeAudit({ adminId: admin.id, req, action: "update", entity: resource, entityId: id, before: serializeOne(before), after: serializeOne(item) });
    if (def.invalidatesConfig) await configService.invalidateConfig();
    return { ok: true, data: serializeOne(item) };
  });

  app.delete("/v1/admin/resources/:resource/:id", async (req) => {
    const { resource, id } = req.params as { resource: string; id: string };
    const def = RESOURCES[resource];
    if (!def) throw notFound(`unknown resource ${resource}`);
    const admin = await requireAdmin(req, def.writePerm as never);
    if (def.model === "setting") {
      const before = await prisma.setting.findUnique({ where: { key: id } });
      if (!before) throw notFound();
      await prisma.setting.delete({ where: { key: id } });
      await writeAudit({ adminId: admin.id, req, action: "delete", entity: resource, entityId: id, before });
      if (def.invalidatesConfig) await configService.invalidateConfig();
      return { ok: true };
    }
    const numId = Number(id);
    if (Number.isNaN(numId)) throw badRequest("numeric id required");
    const before = await delegate(def.model).findUnique({ where: { id: numId } } as never);
    if (!before) throw notFound();
    try {
      await delegate(def.model).delete({ where: { id: numId } } as never);
    } catch (e) {
      throw new AppError("conflict", (e as Error).message.includes("ForeignKeyConstraint")
        ? "cannot delete: referenced by other records"
        : "cannot delete: record is referenced", 409);
    }
    await writeAudit({ adminId: admin.id, req, action: "delete", entity: resource, entityId: id, before: serializeOne(before) });
    if (def.invalidatesConfig) await configService.invalidateConfig();
    return { ok: true };
  });
}

function enrich(resource: string, input: Record<string, unknown>): Record<string, unknown> {
  if (resource === "country-filters" && typeof input.country === "string") input.country = input.country.toUpperCase();
  return input;
}

function serialize(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map(serializeOne);
}

function serializeOne(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    out[k] = typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
