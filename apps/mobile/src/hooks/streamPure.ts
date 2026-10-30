/**
 * SM Live — pure streaming helpers (Prompt 17).
 *
 * Pure functions used by the live streaming screens. Extracted so the
 * test suite can verify behaviour without mounting any React components
 * or importing the LiveKit native module (which is unavailable in jest).
 *
 * Functions:
 *   - nextStreamState        → state machine transition validator.
 *   - formatDuration         → "1:23:45" duration formatter (for the
 *                              host's streaming duration timer).
 *   - connectionQualityLabel → human label for LiveKit's quality enum.
 *   - canEndStream           → guards the End button against accidental
 *                              taps during the connecting state.
 *   - isValidRoomType        → narrows a string to a known room type.
 *   - defaultSlotsForType    → platform default slot count per room type.
 */

export type StreamState =
  | "idle"          // before the user taps Start Live
  | "connecting"    // LiveKit Room.connect() in flight
  | "live"          // connected + publishing (host) or subscribed (viewer)
  | "reconnecting"  // LiveKit reported a transient disconnect
  | "ended"         // host tapped End, or room:ended socket event
  | "error";        // unrecoverable failure (token expired, room closed, etc.)

/** Valid state transitions. Anything not listed is rejected. */
const TRANSITIONS: Record<StreamState, StreamState[]> = {
  idle: ["connecting"],
  connecting: ["live", "error", "ended"],
  live: ["reconnecting", "ended", "error"],
  reconnecting: ["live", "ended", "error"],
  ended: ["idle"],
  error: ["idle"],
};

/**
 * Validate a state transition. Returns the new state if the transition
 * is allowed; throws an Error otherwise. The state machine is strict so
 * the UI can never accidentally render a "connecting" state after the
 * stream is already ended.
 */
export function nextStreamState(current: StreamState, next: StreamState): StreamState {
  const allowed = TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new Error(`invalid stream state transition: ${current} → ${next}`);
  }
  return next;
}

/** Format a duration in seconds as "M:SS" or "H:MM:SS". */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Map a LiveKit ConnectionQuality string to a human label + colour. */
export function connectionQualityLabel(quality: string): { label: string; color: string } {
  switch (quality) {
    case "excellent": return { label: "Excellent", color: "#34d399" };
    case "good": return { label: "Good", color: "#34d399" };
    case "poor": return { label: "Poor", color: "#f59e0b" };
    case "lost": return { label: "Reconnecting", color: "#fb7185" };
    default: return { label: "Unknown", color: "#64748b" };
  }
}

/**
 * Guard the End button — only allow ending when the stream is in a
 * state where ending makes sense (live / reconnecting). Prevents the
 * user from tapping End during the connecting phase (which would leave
 * a half-initialised LiveKit room) or after the stream already ended.
 */
export function canEndStream(state: StreamState): boolean {
  return state === "live" || state === "reconnecting";
}

/** Known room types (mirror of the shared ROOM_TYPES constant). */
export type RoomType = "live" | "voice" | "party";

/** Narrow a string to a RoomType; returns null on unknown values. */
export function isValidRoomType(s: string): s is RoomType {
  return s === "live" || s === "voice" || s === "party";
}

/** Platform default slot count per room type. */
export function defaultSlotsForType(type: RoomType): number {
  switch (type) {
    case "live": return 3;
    case "voice": return 10;
    case "party": return 9;
  }
}

/** Emoji for a room type — used by the Start Live configuration screen. */
export function roomTypeIcon(type: RoomType): string {
  switch (type) {
    case "live": return "🔴";
    case "voice": return "🎙️";
    case "party": return "🎉";
  }
}

/** Human label for a room type. */
export function roomTypeLabel(type: RoomType): string {
  switch (type) {
    case "live": return "Live broadcast";
    case "voice": return "Voice room";
    case "party": return "Party room";
  }
}
