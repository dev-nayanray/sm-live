import {
  VOICE_ROOM_LAYOUTS, getSeatLayout, buildSeatGrid,
  type RoomParticipantView, type SeatSlot,
  nextHandRaiseState, isVoiceRoom, seatLabel, canRaiseHand,
  countFreeSeats, findNextFreeSeat,
} from "../src/hooks/voiceRoomPure";

/**
 * Voice room pure helpers (Prompt 18).
 *
 * Verifies the seat layout configurations, grid building, hand-raise
 * state machine, and seat utility functions.
 */

describe("VOICE_ROOM_LAYOUTS", () => {
  it("includes 5, 10, 15, 20", () => {
    expect(VOICE_ROOM_LAYOUTS).toEqual([5, 10, 15, 20]);
  });
});

describe("getSeatLayout", () => {
  it("returns correct config for 5 slots", () => {
    const layout = getSeatLayout(5);
    expect(layout.slots).toBe(5);
    expect(layout.columns).toBe(3);
    expect(layout.label).toBe("Small Room");
  });
  it("returns correct config for 10 slots", () => {
    const layout = getSeatLayout(10);
    expect(layout.slots).toBe(10);
    expect(layout.columns).toBe(4);
    expect(layout.label).toBe("Medium Room");
  });
  it("returns correct config for 15 slots", () => {
    const layout = getSeatLayout(15);
    expect(layout.slots).toBe(15);
    expect(layout.columns).toBe(5);
    expect(layout.label).toBe("Large Room");
  });
  it("returns correct config for 20 slots", () => {
    const layout = getSeatLayout(20);
    expect(layout.slots).toBe(20);
    expect(layout.columns).toBe(5);
    expect(layout.label).toBe("Extra Large Room");
  });
  it("handles non-standard slot counts with fallback", () => {
    const layout = getSeatLayout(9);
    expect(layout.slots).toBe(9);
    expect(layout.columns).toBe(5);
    expect(layout.label).toBe("9 seats");
  });
});

describe("buildSeatGrid", () => {
  const participants: RoomParticipantView[] = [
    { userId: 1, displayName: "Host", slotIndex: 0, role: "host", muted: false },
    { userId: 2, displayName: "Speaker 1", slotIndex: 1, role: "cohost", muted: false },
    { userId: 3, displayName: "Speaker 2", slotIndex: 2, role: "cohost", muted: true },
    { userId: 4, displayName: "Audience", slotIndex: null, role: "audience", muted: false },
  ];

  it("builds a 5-seat grid with 3 occupied + 2 empty", () => {
    const grid = buildSeatGrid(5, participants);
    expect(grid).toHaveLength(5);
    expect(grid[0]!.occupied).toBe(true);
    expect(grid[0]!.displayName).toBe("Host");
    expect(grid[1]!.occupied).toBe(true);
    expect(grid[2]!.occupied).toBe(true);
    expect(grid[2]!.muted).toBe(true);
    expect(grid[3]!.occupied).toBe(false);
    expect(grid[4]!.occupied).toBe(false);
  });

  it("builds a 10-seat grid with audience in no seat", () => {
    const grid = buildSeatGrid(10, participants);
    expect(grid).toHaveLength(10);
    expect(grid[0]!.occupied).toBe(true);
    expect(grid[1]!.occupied).toBe(true);
    expect(grid[2]!.occupied).toBe(true);
    // Seats 3-9 are empty
    for (let i = 3; i < 10; i++) {
      expect(grid[i]!.occupied).toBe(false);
    }
  });

  it("does not mutate the input array", () => {
    const original = [...participants];
    buildSeatGrid(5, participants);
    expect(participants).toEqual(original);
  });

  it("handles empty participants", () => {
    const grid = buildSeatGrid(5, []);
    expect(grid).toHaveLength(5);
    expect(grid.every((s) => !s.occupied)).toBe(true);
  });
});

describe("nextHandRaiseState", () => {
  it("allows idle → raising", () => {
    expect(nextHandRaiseState("idle", "raising")).toBe("raising");
  });
  it("allows raising → raised", () => {
    expect(nextHandRaiseState("raising", "raised")).toBe("raised");
  });
  it("allows raised → approved", () => {
    expect(nextHandRaiseState("raised", "approved")).toBe("approved");
  });
  it("allows raised → rejected", () => {
    expect(nextHandRaiseState("raised", "rejected")).toBe("rejected");
  });
  it("allows approved → idle (after getting seat, then releasing)", () => {
    expect(nextHandRaiseState("approved", "idle")).toBe("idle");
  });
  it("allows rejected → idle (can try again)", () => {
    expect(nextHandRaiseState("rejected", "idle")).toBe("idle");
  });
  it("rejects idle → raised (must go through raising)", () => {
    expect(() => nextHandRaiseState("idle", "raised")).toThrow(/invalid hand-raise transition/);
  });
  it("rejects approved → raised (already approved, must reset to idle)", () => {
    expect(() => nextHandRaiseState("approved", "raised")).toThrow(/invalid hand-raise transition/);
  });
});

describe("isVoiceRoom", () => {
  it("true for voice", () => {
    expect(isVoiceRoom("voice")).toBe(true);
  });
  it("true for party", () => {
    expect(isVoiceRoom("party")).toBe(true);
  });
  it("false for live", () => {
    expect(isVoiceRoom("live")).toBe(false);
  });
});

describe("seatLabel", () => {
  it("returns 'Host' for slot 0", () => {
    expect(seatLabel(0)).toBe("Host");
  });
  it("returns 'Seat 2' for slot 1", () => {
    expect(seatLabel(1)).toBe("Seat 2");
  });
  it("returns 'Seat 5' for slot 4", () => {
    expect(seatLabel(4)).toBe("Seat 5");
  });
});

describe("canRaiseHand", () => {
  it("true for audience member with no slot and idle hand state", () => {
    expect(canRaiseHand("audience", null, "idle")).toBe(true);
  });
  it("false when user already has a slot", () => {
    expect(canRaiseHand("cohost", 1, "idle")).toBe(false);
  });
  it("false for host", () => {
    expect(canRaiseHand("host", 0, "idle")).toBe(false);
  });
  it("false when hand state is not idle", () => {
    expect(canRaiseHand("audience", null, "raising")).toBe(false);
    expect(canRaiseHand("audience", null, "raised")).toBe(false);
    expect(canRaiseHand("audience", null, "approved")).toBe(false);
  });
});

describe("countFreeSeats", () => {
  it("counts free seats in a partially occupied grid", () => {
    const grid: SeatSlot[] = [
      { index: 0, occupied: true },
      { index: 1, occupied: true },
      { index: 2, occupied: false },
      { index: 3, occupied: false },
      { index: 4, occupied: true },
    ];
    expect(countFreeSeats(grid)).toBe(2);
  });
  it("returns total slots when all empty", () => {
    const grid: SeatSlot[] = Array.from({ length: 5 }, (_, i) => ({ index: i, occupied: false }));
    expect(countFreeSeats(grid)).toBe(5);
  });
  it("returns 0 when all occupied", () => {
    const grid: SeatSlot[] = Array.from({ length: 5 }, (_, i) => ({ index: i, occupied: true }));
    expect(countFreeSeats(grid)).toBe(0);
  });
});

describe("findNextFreeSeat", () => {
  it("returns the first free seat index", () => {
    const grid: SeatSlot[] = [
      { index: 0, occupied: true },
      { index: 1, occupied: true },
      { index: 2, occupied: false },
      { index: 3, occupied: false },
    ];
    expect(findNextFreeSeat(grid)).toBe(2);
  });
  it("returns 0 when first seat is free", () => {
    const grid: SeatSlot[] = [
      { index: 0, occupied: false },
      { index: 1, occupied: true },
    ];
    expect(findNextFreeSeat(grid)).toBe(0);
  });
  it("returns null when all occupied", () => {
    const grid: SeatSlot[] = [
      { index: 0, occupied: true },
      { index: 1, occupied: true },
    ];
    expect(findNextFreeSeat(grid)).toBeNull();
  });
});
