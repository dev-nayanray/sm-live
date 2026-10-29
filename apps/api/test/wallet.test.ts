import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { getPaymentAdapter } from "../src/services/payment.adapter.js";
import { credit, debit, balanceOf } from "../src/services/ledger.service.js";

let userId: number;

beforeAll(async () => {
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await prisma.user.create({
    data: { phone: `+88016700${suffix}`, passwordHash: "x", displayName: `Wallet ${suffix}` },
  });
  await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  userId = user.id;
});

describe("wallet via payment adapter + ledger", () => {
  it("fake adapter always succeeds with a unique external id", async () => {
    const adapter = getPaymentAdapter("fake");
    const a = await adapter.createCharge({ userId, amount: 500 });
    const b = await adapter.createCharge({ userId, amount: 500 });
    expect(a.status).toBe("succeeded");
    expect(a.externalId).not.toBe(b.externalId);
  });

  it("recharge flow: recharge row + ledger credit with matching txKey", async () => {
    const charge = await getPaymentAdapter("fake").createCharge({ userId, amount: 500 });
    const recharge = await prisma.recharge.create({
      data: { userId, amount: 500, provider: "fake", externalId: charge.externalId, status: "succeeded" },
    });
    await credit(userId, "recharge", 500, `recharge:${recharge.id}`, { refType: "recharge", refId: recharge.id });
    expect(await balanceOf(userId)).toBe(500);
    const entry = await prisma.ledgerEntry.findUnique({ where: { txKey: `recharge:${recharge.id}` } });
    expect(entry?.balanceAfter).toBe(500);
  });

  it("refund debits back to the recharged amount and cannot go negative", async () => {
    await debit(userId, "refund", 300, `refund:test:${crypto.randomUUID()}`);
    expect(await balanceOf(userId)).toBe(200);
    await expect(debit(userId, "refund", 9999, `refund:over:${crypto.randomUUID()}`)).rejects.toMatchObject({ status: 422 });
    expect(await balanceOf(userId)).toBe(200);
  });

  it("frozen wallet rejects movements", async () => {
    await prisma.wallet.update({ where: { userId }, data: { frozen: true } });
    await expect(credit(userId, "recharge", 10, `t:frozen:${crypto.randomUUID()}`)).rejects.toMatchObject({ status: 422 });
    await prisma.wallet.update({ where: { userId }, data: { frozen: false } });
  });
});
