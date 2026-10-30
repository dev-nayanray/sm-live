import {
  debounce, isHomeFeedCategory, isRoomType, sortRoomsByAudience, dedupeRoomsById,
  roomTypeIcon, roomTypeLabel, formatCount, formatRelativeTime,
} from "../src/hooks/feedPure";

/**
 * Pure feed helpers (Prompt 15).
 *
 * Verifies the contract the Home + Discover + Search screens rely on:
 * debounce timing, type narrowing, stable sort, dedupe, and the
 * relative-time / count formatters.
 */

describe("isHomeFeedCategory", () => {
  it("accepts the four known categories", () => {
    expect(isHomeFeedCategory("for_you")).toBe(true);
    expect(isHomeFeedCategory("live")).toBe(true);
    expect(isHomeFeedCategory("popular")).toBe(true);
    expect(isHomeFeedCategory("creators")).toBe(true);
  });
  it("rejects unknown strings", () => {
    expect(isHomeFeedCategory("following")).toBe(false);
    expect(isHomeFeedCategory("")).toBe(false);
  });
});

describe("isRoomType", () => {
  it("accepts live / voice / party", () => {
    expect(isRoomType("live")).toBe(true);
    expect(isRoomType("voice")).toBe(true);
    expect(isRoomType("party")).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isRoomType("video")).toBe(false);
    expect(isRoomType("")).toBe(false);
  });
});

describe("debounce", () => {
  it("fires only the last call within the window", async () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const d = debounce(fn, 100);
    d("a");
    d("b");
    d("c");
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
    jest.useRealTimers();
  });

  it(".cancel() prevents the pending call", async () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const d = debounce(fn, 100);
    d("a");
    d.cancel();
    jest.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("sortRoomsByAudience", () => {
  it("sorts descending by audienceCount", () => {
    const rooms = [
      { id: 1, audienceCount: 5 },
      { id: 2, audienceCount: 50 },
      { id: 3, audienceCount: 10 },
    ];
    const sorted = sortRoomsByAudience(rooms);
    expect(sorted.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the input array", () => {
    const rooms = [
      { id: 1, audienceCount: 5 },
      { id: 2, audienceCount: 50 },
    ];
    const original = [...rooms];
    sortRoomsByAudience(rooms);
    expect(rooms).toEqual(original);
  });
});

describe("dedupeRoomsById", () => {
  it("keeps the first occurrence of each id", () => {
    const rooms = [
      { id: 1, title: "first" },
      { id: 2, title: "second" },
      { id: 1, title: "duplicate (should be dropped)" },
      { id: 3, title: "third" },
    ];
    const deduped = dedupeRoomsById(rooms);
    expect(deduped).toHaveLength(3);
    expect(deduped.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(deduped[0]!.title).toBe("first");
  });

  it("handles empty array", () => {
    expect(dedupeRoomsById([])).toEqual([]);
  });
});

describe("roomTypeIcon + roomTypeLabel", () => {
  it("returns emoji for known types", () => {
    expect(roomTypeIcon("live")).toBe("🔴");
    expect(roomTypeIcon("voice")).toBe("🎙️");
    expect(roomTypeIcon("party")).toBe("🎉");
  });
  it("returns fallback for unknown types", () => {
    expect(roomTypeIcon("unknown")).toBe("🎯");
  });
  it("returns human label for known types", () => {
    expect(roomTypeLabel("live")).toBe("Live");
    expect(roomTypeLabel("voice")).toBe("Voice");
    expect(roomTypeLabel("party")).toBe("Party");
  });
  it("capitalises unknown types", () => {
    expect(roomTypeLabel("custom")).toBe("Custom");
  });
});

describe("formatCount", () => {
  it("renders exact counts under 1000", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(5)).toBe("5");
    expect(formatCount(999)).toBe("999");
  });
  it("renders '1.2k' format for thousands", () => {
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(9999)).toBe("9.9k");
    expect(formatCount(10000)).toBe("10k");
    expect(formatCount(12345)).toBe("12k");
  });
  it("renders '12M' format for millions", () => {
    expect(formatCount(1_000_000)).toBe("1M");
    expect(formatCount(1_200_000)).toBe("1.2M");
    expect(formatCount(12_000_000)).toBe("12M");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("returns 'just now' for < 60s", () => {
    expect(formatRelativeTime(new Date("2026-10-30T11:59:30Z"), now)).toBe("just now");
  });
  it("returns '5m ago' for minutes", () => {
    expect(formatRelativeTime(new Date("2026-10-30T11:55:00Z"), now)).toBe("5m ago");
  });
  it("returns '2h ago' for hours", () => {
    expect(formatRelativeTime(new Date("2026-10-30T10:00:00Z"), now)).toBe("2h ago");
  });
  it("returns '3d ago' for days within a week", () => {
    expect(formatRelativeTime(new Date("2026-10-27T12:00:00Z"), now)).toBe("3d ago");
  });
  it("returns a date string for > 7 days", () => {
    const out = formatRelativeTime(new Date("2026-10-01T12:00:00Z"), now);
    // Could vary by locale but always contains "Oct"
    expect(out).toContain("Oct");
  });
  it("accepts ISO strings", () => {
    expect(formatRelativeTime("2026-10-30T11:55:00Z", now)).toBe("5m ago");
  });
  it("returns 'just now' for future timestamps (defensive)", () => {
    expect(formatRelativeTime(new Date("2026-10-30T13:00:00Z"), now)).toBe("just now");
  });
});
