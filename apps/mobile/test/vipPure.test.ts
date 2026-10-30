import {
  vipLevelLabel, vipBadgeIcon, formatRank, formatPoints,
  daysRemaining, isExpired, planKeyForLevel, RANKING_PERIODS,
} from "../src/hooks/vipPure";

describe("vipLevelLabel", () => {
  it("returns 'None' for 0", () => { expect(vipLevelLabel(0)).toBe("None"); });
  it("returns 'VIP N' for positive", () => {
    expect(vipLevelLabel(1)).toBe("VIP 1");
    expect(vipLevelLabel(3)).toBe("VIP 3");
  });
});

describe("vipBadgeIcon", () => {
  it("returns empty for 0", () => { expect(vipBadgeIcon(0)).toBe(""); });
  it("returns star for 1", () => { expect(vipBadgeIcon(1)).toBe("⭐"); });
  it("returns sparkle for 2", () => { expect(vipBadgeIcon(2)).toBe("🌟"); });
  it("returns crown for 3+", () => { expect(vipBadgeIcon(3)).toBe("👑"); });
});

describe("formatRank", () => {
  it("medals for top 3", () => {
    expect(formatRank(1)).toBe("🥇 #1");
    expect(formatRank(2)).toBe("🥈 #2");
    expect(formatRank(3)).toBe("🥉 #3");
  });
  it("plain number for others", () => {
    expect(formatRank(4)).toBe("#4");
    expect(formatRank(100)).toBe("#100");
  });
});

describe("formatPoints", () => {
  it("formats with separators", () => {
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(1234)).toBe("1,234");
  });
});

describe("daysRemaining", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("returns days until expiry", () => {
    expect(daysRemaining("2026-11-02T12:00:00Z", now)).toBe(2);
  });
  it("returns 0 for past", () => {
    expect(daysRemaining("2026-10-29T12:00:00Z", now)).toBe(0);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("true for past", () => { expect(isExpired("2026-10-01T00:00:00Z", now)).toBe(true); });
  it("false for future", () => { expect(isExpired("2026-12-01T00:00:00Z", now)).toBe(false); });
});

describe("planKeyForLevel", () => {
  it("generates correct key", () => {
    expect(planKeyForLevel(1)).toBe("vip1_30d");
    expect(planKeyForLevel(3)).toBe("vip3_30d");
  });
});

describe("RANKING_PERIODS", () => {
  it("includes 3 periods", () => {
    expect(RANKING_PERIODS).toHaveLength(3);
    expect(RANKING_PERIODS.map((p) => p.key)).toEqual(["daily", "weekly", "monthly"]);
  });
});
