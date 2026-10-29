import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { recoverStuckRounds } from "./rounds.recovery.js";
import { dailyRevenueRollup, rtpSnapshot, monthlyServiceFees } from "./scheduled.js";
import { generateProviderBills } from "./bills.js";

export const QUEUE_NAME = "sm-live-jobs";

export interface JobPayload {
  job: "recover-rounds" | "daily-rollup" | "rtp-snapshot" | "monthly-fees" | "provider-bills";
}

export function startScheduler() {
  const queue = new Queue<JobPayload>(QUEUE_NAME, { connection: redis.duplicate() });

  const addIfMissing = async (name: string, pattern: string | "every-30s", payload: JobPayload) => {
    if (pattern === "every-30s") {
      await queue.add(name, payload, { repeat: { every: 30_000 }, jobId: `${name}-repeat` });
    } else {
      await queue.add(name, payload, { repeat: { pattern }, jobId: `${name}-repeat` });
    }
  };

  const boot = async () => {
    try {
      await addIfMissing("recover-rounds", "every-30s", { job: "recover-rounds" });
      await addIfMissing("daily-rollup", "5 0 * * *", { job: "daily-rollup" });
      await addIfMissing("rtp-snapshot", "0 * * * *", { job: "rtp-snapshot" });
      await addIfMissing("monthly-fees", "20 0 1 * *", { job: "monthly-fees" });
      await addIfMissing("provider-bills", "30 0 1 * *", { job: "provider-bills" });
      logger.info("scheduler jobs registered");
    } catch (e) {
      logger.error({ err: e }, "scheduler registration failed — will not retry");
    }
  };
  void boot();

  const worker = new Worker<JobPayload>(
    QUEUE_NAME,
    async (job) => {
      switch (job.data.job) {
        case "recover-rounds":
          return recoverStuckRounds();
        case "daily-rollup":
          return dailyRevenueRollup();
        case "rtp-snapshot":
          return rtpSnapshot();
        case "monthly-fees":
          return monthlyServiceFees();
        case "provider-bills":
          return generateProviderBills();
        default:
          logger.warn({ job: job.data.job }, "unknown job");
      }
    },
    { connection: redis.duplicate(), concurrency: 2 }
  );

  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message }, "job failed"));

  const shutdown = async () => {
    await Promise.allSettled([worker.close(), queue.close()]);
  };
  return { queue, worker, shutdown };
}
