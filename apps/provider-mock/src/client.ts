import crypto from "node:crypto";

/**
 * Signed HTTP client — behaves exactly like a real game provider:
 * every call to the platform wallet API carries X-Api-Key/X-Timestamp/X-Signature.
 */
export interface ProviderClientConfig {
  apiBase: string;
  apiKey: string;
  apiSecret: string;
}

export function createProviderClient(cfg: ProviderClientConfig) {
  async function call<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<{ status: number; body: T }> {
    const rawBody = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000);
    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const signature = crypto.createHmac("sha256", cfg.apiSecret).update(`POST|${path}|${ts}|${bodyHash}`).digest("hex");
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": cfg.apiKey,
        "X-Timestamp": String(ts),
        "X-Signature": signature,
      },
      body: rawBody,
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body: json };
  }

  return {
    balance: (sessionId: string) => call<{ ok: boolean; data?: { balance: number } }>("/provider/wallet/balance", { sessionId }),
    bet: (args: { sessionId: string; roundId: string; amount: number; txId: string }) => call("/provider/bet", args),
    win: (args: { sessionId: string; roundId: string; amount: number; txId: string; payoutMultiplier?: number }) => call("/provider/win", args),
    cancel: (args: { sessionId: string; roundId: string; txId: string }) => call("/provider/cancel", args),
    refund: (args: { sessionId: string; roundId: string; txId: string }) => call("/provider/refund", args),
    roundWebhook: (args: Record<string, unknown>) => call("/provider/webhook/round", args),
  };
}
