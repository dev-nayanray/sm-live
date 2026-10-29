import type { FastifyInstance } from "fastify";
import { paginationQuery } from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { validate, queryOf } from "../../lib/validate.js";

/** Mobile content feeds: short videos + moments. */
export async function contentRoutes(app: FastifyInstance) {
  app.get("/v1/content/short-videos", async (req) => {
    const q = validate(paginationQuery, queryOf(req));
    const where = { status: "published" };
    const [total, items] = await Promise.all([
      prisma.shortVideo.count({ where }),
      prisma.shortVideo.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.get("/v1/content/moments", async (req) => {
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.moment.count(),
      prisma.moment.findMany({ orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });
}
