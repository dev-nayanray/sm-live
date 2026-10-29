import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "smlive_" });

export const httpRequestCounter = new client.Counter({
  name: "smlive_http_requests_total",
  help: "HTTP requests by method/route/status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
  name: "smlive_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const ledgerTxCounter = new client.Counter({
  name: "smlive_ledger_transactions_total",
  help: "Ledger entries posted by kind",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
