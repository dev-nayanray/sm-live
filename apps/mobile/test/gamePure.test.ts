import {
  gameStatusLabel, gameStatusTone, betStatusLabel, betStatusTone,
  gameIcon, formatCoins, canPlay, formatGameTime,
} from "../src/hooks/gamePure";

describe("gameStatusLabel", () => {
  it("maps known statuses", () => {
    expect(gameStatusLabel("active")).toBe("Available");
    expect(gameStatusLabel("maintenance")).toBe("Under Maintenance");
    expect(gameStatusLabel("disabled")).toBe("Disabled");
  });
  it("capitalizes unknown", () => {
    expect(gameStatusLabel("custom")).toBe("Custom");
  });
});

describe("gameStatusTone", () => {
  it("maps known statuses", () => {
    expect(gameStatusTone("active")).toBe("success");
    expect(gameStatusTone("maintenance")).toBe("warning");
    expect(gameStatusTone("disabled")).toBe("danger");
  });
  it("returns muted for unknown", () => {
    expect(gameStatusTone("custom")).toBe("muted");
  });
});

describe("betStatusLabel", () => {
  it("maps known statuses", () => {
    expect(betStatusLabel("placed")).toBe("Pending");
    expect(betStatusLabel("won")).toBe("Won");
    expect(betStatusLabel("lost")).toBe("Lost");
    expect(betStatusLabel("cancelled")).toBe("Cancelled");
    expect(betStatusLabel("refunded")).toBe("Refunded");
  });
});

describe("betStatusTone", () => {
  it("maps known statuses", () => {
    expect(betStatusTone("placed")).toBe("warning");
    expect(betStatusTone("won")).toBe("success");
    expect(betStatusTone("lost")).toBe("danger");
    expect(betStatusTone("cancelled")).toBe("muted");
    expect(betStatusTone("refunded")).toBe("vip");
  });
});

describe("gameIcon", () => {
  it("returns diamond for pro", () => { expect(gameIcon(true)).toBe("💎"); });
  it("returns dice for non-pro", () => { expect(gameIcon(false)).toBe("🎲"); });
});

describe("formatCoins", () => {
  it("formats with separators", () => {
    expect(formatCoins(0)).toBe("0");
    expect(formatCoins(1234)).toBe("1,234");
  });
});

describe("canPlay", () => {
  it("true for active", () => { expect(canPlay("active")).toBe(true); });
  it("false for others", () => {
    expect(canPlay("maintenance")).toBe(false);
    expect(canPlay("disabled")).toBe(false);
  });
});

describe("formatGameTime", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("minutes ago", () => {
    expect(formatGameTime("2026-10-31T11:55:00Z", now)).toBe("5m ago");
  });
  it("hours ago", () => {
    expect(formatGameTime("2026-10-31T10:00:00Z", now)).toBe("2h ago");
  });
  it("days ago", () => {
    expect(formatGameTime("2026-10-28T12:00:00Z", now)).toBe("3d ago");
  });
  it("date for > 7 days", () => {
    const out = formatGameTime("2026-10-01T12:00:00Z", now);
    expect(out).toContain("Oct");
  });
});
