import {
  nextStreamState, formatDuration, connectionQualityLabel, canEndStream,
  isValidRoomType, defaultSlotsForType, roomTypeIcon, roomTypeLabel,
  type StreamState, type RoomType,
} from "../src/hooks/streamPure";

/**
 * Pure streaming helpers (Prompt 17).
 *
 * Verifies the state machine, duration formatter, connection-quality
 * label, End-button guard, and room-type helpers used by the host +
 * viewer screens.
 */

describe("nextStreamState", () => {
  it("allows idle → connecting", () => {
    expect(nextStreamState("idle", "connecting")).toBe("connecting");
  });
  it("allows connecting → live", () => {
    expect(nextStreamState("connecting", "live")).toBe("live");
  });
  it("allows live → reconnecting", () => {
    expect(nextStreamState("live", "reconnecting")).toBe("reconnecting");
  });
  it("allows live → ended", () => {
    expect(nextStreamState("live", "ended")).toBe("ended");
  });
  it("allows reconnecting → live (recovery)", () => {
    expect(nextStreamState("reconnecting", "live")).toBe("live");
  });
  it("allows ended → idle (start over)", () => {
    expect(nextStreamState("ended", "idle")).toBe("idle");
  });
  it("rejects idle → live (must go through connecting)", () => {
    expect(() => nextStreamState("idle", "live")).toThrow(/invalid stream state transition/);
  });
  it("rejects ended → live (must reset to idle first)", () => {
    expect(() => nextStreamState("ended", "live")).toThrow(/invalid stream state transition/);
  });
  it("rejects live → idle (must end first)", () => {
    expect(() => nextStreamState("live", "idle")).toThrow(/invalid stream state transition/);
  });
});

describe("formatDuration", () => {
  it("formats 0 seconds as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
  it("formats 65 seconds as 1:05", () => {
    expect(formatDuration(65)).toBe("1:05");
  });
  it("formats 3599 seconds as 59:59", () => {
    expect(formatDuration(3599)).toBe("59:59");
  });
  it("formats 3600 seconds as 1:00:00", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
  });
  it("formats 3661 seconds as 1:01:01", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  it("handles negative input defensively", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("connectionQualityLabel", () => {
  it("maps excellent → green", () => {
    const q = connectionQualityLabel("excellent");
    expect(q.label).toBe("Excellent");
    expect(q.color).toBe("#34d399");
  });
  it("maps good → green", () => {
    const q = connectionQualityLabel("good");
    expect(q.label).toBe("Good");
    expect(q.color).toBe("#34d399");
  });
  it("maps poor → amber", () => {
    const q = connectionQualityLabel("poor");
    expect(q.label).toBe("Poor");
    expect(q.color).toBe("#f59e0b");
  });
  it("maps lost → red + 'Reconnecting'", () => {
    const q = connectionQualityLabel("lost");
    expect(q.label).toBe("Reconnecting");
    expect(q.color).toBe("#fb7185");
  });
  it("maps unknown → muted", () => {
    const q = connectionQualityLabel("foo");
    expect(q.label).toBe("Unknown");
    expect(q.color).toBe("#64748b");
  });
});

describe("canEndStream", () => {
  it("true for live + reconnecting", () => {
    expect(canEndStream("live")).toBe(true);
    expect(canEndStream("reconnecting")).toBe(true);
  });
  it("false for idle + connecting + ended + error", () => {
    expect(canEndStream("idle")).toBe(false);
    expect(canEndStream("connecting")).toBe(false);
    expect(canEndStream("ended")).toBe(false);
    expect(canEndStream("error")).toBe(false);
  });
});

describe("isValidRoomType", () => {
  it("accepts live / voice / party", () => {
    expect(isValidRoomType("live")).toBe(true);
    expect(isValidRoomType("voice")).toBe(true);
    expect(isValidRoomType("party")).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isValidRoomType("video")).toBe(false);
    expect(isValidRoomType("")).toBe(false);
  });
});

describe("defaultSlotsForType", () => {
  it("returns 3 for live", () => {
    expect(defaultSlotsForType("live")).toBe(3);
  });
  it("returns 10 for voice", () => {
    expect(defaultSlotsForType("voice")).toBe(10);
  });
  it("returns 9 for party", () => {
    expect(defaultSlotsForType("party")).toBe(9);
  });
});

describe("roomTypeIcon + roomTypeLabel", () => {
  it("returns emoji for each type", () => {
    expect(roomTypeIcon("live")).toBe("🔴");
    expect(roomTypeIcon("voice")).toBe("🎙️");
    expect(roomTypeIcon("party")).toBe("🎉");
  });
  it("returns human label for each type", () => {
    expect(roomTypeLabel("live")).toBe("Live broadcast");
    expect(roomTypeLabel("voice")).toBe("Voice room");
    expect(roomTypeLabel("party")).toBe("Party room");
  });
});

// keep the type imports referenced for typecheck
void (null as unknown as StreamState);
void (null as unknown as RoomType);
