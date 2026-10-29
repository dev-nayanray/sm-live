import crypto from "node:crypto";
import { AppError } from "../lib/errors.js";

/**
 * Pluggable payment adapter. The fake adapter always succeeds instantly —
 * swap in a real PSP (stripe/upay/local wallet) behind the same interface.
 */
export interface PaymentAdapter {
  readonly name: string;
  createCharge(args: { userId: number; amount: number; meta?: Record<string, unknown> }): Promise<{
    externalId: string;
    status: "succeeded" | "pending" | "failed";
    redirectUrl?: string;
  }>;
}

class FakeAdapter implements PaymentAdapter {
  readonly name = "fake";
  async createCharge(args: { userId: number; amount: number }) {
    if (args.amount <= 0) throw new AppError("bad_request", "amount must be positive");
    return {
      externalId: `fake_${crypto.randomUUID()}`,
      status: "succeeded" as const,
    };
  }
}

const adapters: Record<string, PaymentAdapter> = {
  fake: new FakeAdapter(),
};

export function getPaymentAdapter(name: string): PaymentAdapter {
  const a = adapters[name];
  if (!a) throw new AppError("bad_request", `unknown payment adapter: ${name}`);
  return a;
}
