/**
 * SM Live — pure voice room helpers (Prompt 18).
 *
 * Pure functions used by the voice room UI. Extracted so the test
 * suite can verify behaviour without mounting React components.
 *
 * Functions:
 *   - VOICE_ROOM_LAYOUTS          → the 4 supported seat layouts.
 *   - getSeatLayout(slots)         → the grid configuration for a slot count.
 *   - buildSeatGrid(slots, parts)  → maps participants onto seat indices.
 *   - HandRaiseState               → type union for hand-raise UI states.
 *   - nextHandRaiseState          → validates hand-raise transitions.
 *   - isVoiceRoom(roomType)        → narrows a room type to voice/party.
 *   - seatLabel(slotIndex)         → human label ("Host" / "Seat 2" / "Empty").
 *   - canRaiseHand(role, slotIndex) → guards the hand-raise button.
 */

/** The four supported voice room seat layouts (Prompt 18 spec). */
export const VOICE_ROOM_LAYOUTS = [5, 10, 15, 20] as const;
export type VoiceRoomLayout = (typeof VOICE_ROOM_LAYOUTS)[number];

/** Layout metadata — columns + label for each seat count. */
export interface SeatLayoutConfig {
  slots: number;
  columns: number;
  label: string;
}

/** Get the grid configuration for a given slot count. */
export function getSeatLayout(slots: number): SeatLayoutConfig {
  switch (slots) {
    case 5: return { slots: 5, columns: 3, label: "Small Room" };
    case 10: return { slots: 10, columns: 4, label: "Medium Room" };
    case 15: return { slots: 15, columns: 5, label: "Large Room" };
    case 20: return { slots: 20, columns: 5, label: "Extra Large Room" };
    default:
      // Fallback for non-standard slot counts (3 for live rooms, 9 for
      // party rooms — these still render but use a default column count).
      return { slots, columns: Math.min(slots, 5), label: `${slots} seats` };
  }
}

/** A seat in the grid — either occupied by a participant or empty. */
export interface SeatSlot {
  index: number;
  occupied: boolean;
  userId?: number;
  displayName?: string;
  avatarUrl?: string;
  vipLevel?: number;
  nobleLevel?: number;
  role?: string;
  muted?: boolean;
}

/** A participant in the room (from /v1/rooms/:id response). */
export interface RoomParticipantView {
  userId: number;
  displayName: string;
  avatarUrl?: string;
  vipLevel?: number;
  nobleLevel?: number;
  slotIndex: number | null;
  role: string;
  muted: boolean;
}

/**
 * Build the seat grid from the room's slot count + participant list.
 * Returns an array of SeatSlot with length === slots. Slot 0 is always
 * the host; remaining slots are filled from participants that have a
 * slotIndex. Empty slots have occupied=false.
 *
 * This function is pure — it doesn't mutate the input array.
 */
export function buildSeatGrid(slots: number, participants: RoomParticipantView[]): SeatSlot[] {
  const grid: SeatSlot[] = Array.from({ length: slots }, (_, i) => ({
    index: i,
    occupied: false,
  }));
  for (const p of participants) {
    if (p.slotIndex != null && p.slotIndex >= 0 && p.slotIndex < slots) {
      grid[p.slotIndex] = {
        index: p.slotIndex,
        occupied: true,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        vipLevel: p.vipLevel,
        nobleLevel: p.nobleLevel,
        role: p.role,
        muted: p.muted,
      };
    }
  }
  return grid;
}

/** Hand-raise UI state machine. */
export type HandRaiseState = "idle" | "raising" | "raised" | "approved" | "rejected";

/** Valid hand-raise transitions. */
const HAND_TRANSITIONS: Record<HandRaiseState, HandRaiseState[]> = {
  idle: ["raising"],
  raising: ["raised", "rejected", "idle"],
  raised: ["approved", "rejected", "idle"],
  approved: ["idle"],
  rejected: ["idle"],
};

/** Validate a hand-raise state transition. Throws on invalid. */
export function nextHandRaiseState(current: HandRaiseState, next: HandRaiseState): HandRaiseState {
  const allowed = HAND_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new Error(`invalid hand-raise transition: ${current} → ${next}`);
  }
  return next;
}

/** Check if a room type is a voice/party room (multi-mic enabled). */
export function isVoiceRoom(roomType: string): boolean {
  return roomType === "voice" || roomType === "party";
}

/** Human label for a seat index. Slot 0 = "Host", others = "Seat N+1". */
export function seatLabel(slotIndex: number): string {
  if (slotIndex === 0) return "Host";
  return `Seat ${slotIndex + 1}`;
}

/**
 * Guard the hand-raise button — only allow raising when the user is
 * in the audience (no slot) and not already in a hand-raise state.
 */
export function canRaiseHand(role: string, slotIndex: number | null, handState: HandRaiseState): boolean {
  if (slotIndex != null) return false; // already has a seat
  if (role === "host") return false; // host can't raise hand
  return handState === "idle";
}

/**
 * Count how many seats are free in the grid.
 */
export function countFreeSeats(grid: SeatSlot[]): number {
  return grid.filter((s) => !s.occupied).length;
}

/**
 * Find the next free seat index (lowest available). Returns null if
 * all seats are taken.
 */
export function findNextFreeSeat(grid: SeatSlot[]): number | null {
  for (const seat of grid) {
    if (!seat.occupied) return seat.index;
  }
  return null;
}
