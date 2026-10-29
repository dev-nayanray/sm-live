import { Redis } from "ioredis";
import { env } from "../env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
redis.on("error", (e: Error) => {
  // keep startup resilient; BullMQ retries connection
  if (process.env.NODE_ENV !== "test") console.error("[redis]", e.message);
});
