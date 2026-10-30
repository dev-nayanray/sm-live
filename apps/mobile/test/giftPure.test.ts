import {
  formatCoinAmount, giftCategoryLabel, totalGiftCost, canAffordGift,
  groupGiftsByCategory, formatTransactionKind, isCreditKind, isDebitKind,
  formatGiftHistoryTime, giftAnimationIcon, GIFT_CATEGORIES,
  type GiftView,
} from "../src/hooks/giftPure";

/**
 * Gift + wallet pure helpers (Prompt 20).
 */

const gift = (overrides: Partial<GiftView> = {}): GiftView => ({
  id: 1, name: "Rose", iconUrl: "", price: 10, category: "basic",
  animation: "small", enabled: true, sortOrder: 0,
  ...overrides,
});

describe("formatCoinAmount", () => {
  it("formats with thousands separators", () => {
    expect(formatCoinAmount(0)).toBe("0");
    expect(formatCoinAmount(1234)).toBe("1,234");
    expect(formatCoinAmount(1000000)).toBe("1,000,000");
  });
});

describe("giftCategoryLabel", () => {
  it("maps known categories", () => {
    expect(giftCategoryLabel("basic")).toBe("Popular");
    expect(giftCategoryLabel("premium")).toBe("Premium");
    expect(giftCategoryLabel("luxury")).toBe("Luxury");
    expect(giftCategoryLabel("seasonal")).toBe("Seasonal");
    expect(giftCategoryLabel("special")).toBe("Special");
  });
  it("capitalizes unknown categories", () => {
    expect(giftCategoryLabel("custom")).toBe("Custom");
  });
});

describe("totalGiftCost", () => {
  it("multiplies price × quantity", () => {
    expect(totalGiftCost(10, 1)).toBe(10);
    expect(totalGiftCost(50, 3)).toBe(150);
    expect(totalGiftCost(100, 0)).toBe(0);
  });
});

describe("canAffordGift", () => {
  it("true when balance >= cost", () => {
    expect(canAffordGift(100, 10, 5)).toBe(true);
    expect(canAffordGift(50, 50, 1)).toBe(true);
  });
  it("false when balance < cost", () => {
    expect(canAffordGift(49, 50, 1)).toBe(false);
    expect(canAffordGift(0, 10, 1)).toBe(false);
  });
});

describe("groupGiftsByCategory", () => {
  it("groups gifts by category", () => {
    const gifts = [
      gift({ id: 1, category: "basic" }),
      gift({ id: 2, category: "basic" }),
      gift({ id: 3, category: "premium" }),
    ];
    const map = groupGiftsByCategory(gifts);
    expect(map.get("basic")?.length).toBe(2);
    expect(map.get("premium")?.length).toBe(1);
    expect(map.has("luxury")).toBe(false);
  });
  it("handles empty list", () => {
    expect(groupGiftsByCategory([]).size).toBe(0);
  });
});

describe("formatTransactionKind", () => {
  it("maps known kinds", () => {
    expect(formatTransactionKind("recharge")).toBe("Coin recharge");
    expect(formatTransactionKind("gift_debit")).toBe("Gift sent");
    expect(formatTransactionKind("gift_credit")).toBe("Gift received");
    expect(formatTransactionKind("bet_debit")).toBe("Bet placed");
    expect(formatTransactionKind("win_credit")).toBe("Win credited");
    expect(formatTransactionKind("refund")).toBe("Refund");
  });
  it("replaces underscores for unknown kinds", () => {
    expect(formatTransactionKind("custom_kind")).toBe("custom kind");
  });
});

describe("isCreditKind + isDebitKind", () => {
  it("positive = credit", () => {
    expect(isCreditKind(100)).toBe(true);
    expect(isDebitKind(100)).toBe(false);
  });
  it("negative = debit", () => {
    expect(isCreditKind(-50)).toBe(false);
    expect(isDebitKind(-50)).toBe(true);
  });
  it("zero = neither", () => {
    expect(isCreditKind(0)).toBe(false);
    expect(isDebitKind(0)).toBe(false);
  });
});

describe("formatGiftHistoryTime", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("just now for < 60s", () => {
    expect(formatGiftHistoryTime("2026-10-31T11:59:30Z", now)).toBe("just now");
  });
  it("minutes ago", () => {
    expect(formatGiftHistoryTime("2026-10-31T11:55:00Z", now)).toBe("5m ago");
  });
  it("hours ago", () => {
    expect(formatGiftHistoryTime("2026-10-31T10:00:00Z", now)).toBe("2h ago");
  });
  it("days ago", () => {
    expect(formatGiftHistoryTime("2026-10-28T12:00:00Z", now)).toBe("3d ago");
  });
  it("date for > 7 days", () => {
    const out = formatGiftHistoryTime("2026-10-01T12:00:00Z", now);
    expect(out).toContain("Oct");
  });
});

describe("giftAnimationIcon", () => {
  it("returns emoji for each animation type", () => {
    expect(giftAnimationIcon("none")).toBe("🎁");
    expect(giftAnimationIcon("small")).toBe("✨");
    expect(giftAnimationIcon("full")).toBe("🎆");
  });
  it("returns fallback for unknown", () => {
    expect(giftAnimationIcon("mega")).toBe("🎁");
  });
});

describe("GIFT_CATEGORIES", () => {
  it("includes 5 categories", () => {
    expect(GIFT_CATEGORIES).toEqual(["basic", "premium", "luxury", "seasonal", "special"]);
  });
});
