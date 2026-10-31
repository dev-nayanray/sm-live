import {
  categoryIcon, categoryLabel, formatNotificationTime,
  ticketStatusLabel, ticketStatusTone, TICKET_STATUSES, TICKET_CATEGORIES,
} from "../src/hooks/notificationPure";

describe("categoryIcon", () => {
  it("returns emoji for each category", () => {
    expect(categoryIcon("gift")).toBe("🎁");
    expect(categoryIcon("dm")).toBe("💬");
    expect(categoryIcon("follow")).toBe("➕");
    expect(categoryIcon("vip")).toBe("👑");
  });
  it("returns bell for unknown", () => {
    expect(categoryIcon("custom")).toBe("🔔");
  });
});

describe("categoryLabel", () => {
  it("returns human label", () => {
    expect(categoryLabel("gift")).toBe("Gift");
    expect(categoryLabel("dm")).toBe("Message");
    expect(categoryLabel("system")).toBe("System");
  });
  it("capitalizes unknown", () => {
    expect(categoryLabel("custom")).toBe("Custom");
  });
});

describe("formatNotificationTime", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("just now for < 60s", () => {
    expect(formatNotificationTime("2026-10-31T11:59:30Z", now)).toBe("just now");
  });
  it("minutes ago", () => {
    expect(formatNotificationTime("2026-10-31T11:55:00Z", now)).toBe("5m ago");
  });
  it("hours ago", () => {
    expect(formatNotificationTime("2026-10-31T10:00:00Z", now)).toBe("2h ago");
  });
  it("days ago", () => {
    expect(formatNotificationTime("2026-10-28T12:00:00Z", now)).toBe("3d ago");
  });
  it("date for > 7 days", () => {
    const out = formatNotificationTime("2026-10-01T12:00:00Z", now);
    expect(out).toContain("Oct");
  });
});

describe("ticketStatusLabel", () => {
  it("maps known statuses", () => {
    expect(ticketStatusLabel("new")).toBe("New");
    expect(ticketStatusLabel("in_progress")).toBe("In Progress");
    expect(ticketStatusLabel("waiting_user")).toBe("Waiting for You");
    expect(ticketStatusLabel("resolved")).toBe("Resolved");
    expect(ticketStatusLabel("closed")).toBe("Closed");
  });
});

describe("ticketStatusTone", () => {
  it("maps known statuses", () => {
    expect(ticketStatusTone("new")).toBe("primary");
    expect(ticketStatusTone("open")).toBe("warning");
    expect(ticketStatusTone("resolved")).toBe("success");
    expect(ticketStatusTone("closed")).toBe("muted");
  });
});

describe("TICKET_STATUSES", () => {
  it("includes 7 statuses", () => {
    expect(TICKET_STATUSES).toHaveLength(7);
  });
});

describe("TICKET_CATEGORIES", () => {
  it("includes 10 categories", () => {
    expect(TICKET_CATEGORIES).toHaveLength(10);
  });
});
