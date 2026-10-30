/**
 * SM Live — pure feed helpers (Prompt 15).
 *
 * Pure functions used by the Home + Discover + Search screens. Extracted
 * so the test suite can verify behaviour without mounting any React
 * components.
 *
 * Functions:
 *   - debounce              → keypress debouncer for the search input.
 *   - isHomeFeedCategory     → narrows a string to a known category key.
 *   - isRoomType             → narrows a string to a known room type.
 *   - sortRoomsByAudience    → stable sort by audience count (desc).
 *   - dedupeRoomsById        → de-duplicate a list by room id.
 *   - roomTypeIcon           → emoji for a room type (UI helper).
 *   - roomTypeLabel          → human-readable label for a room type.
 *   - formatAudienceCount    → "1.2k" / "12k" formatter for big numbers.
 *   - formatRelativeTime     → "5m ago" / "2h ago" / "3d ago" formatter.
 */

export type HomeFeedCategory = "for_you" | "live" | "popular" | "creators";
export type RoomType = "live" | "voice" | "party";

/** Known home feed category keys (mirror of the backend homeFeedQuerySchema). */
export const HOME_FEED_CATEGORIES: readonly HomeFeedCategory[] = ["for_you", "live", "popular", "creators"] as const;

/** Known room types (mirror of the shared ROOM_TYPES constant). */
export const ROOM_TYPE_VALUES: readonly RoomType[] = ["live", "voice", "party"] as const;

/** Narrow a string to a HomeFeedCategory; returns null on unknown values. */
export function isHomeFeedCategory(s: string): s is HomeFeedCategory {
  return (HOME_FEED_CATEGORIES as readonly string[]).includes(s);
}

/** Narrow a string to a RoomType; returns null on unknown values. */
export function isRoomType(s: string): s is RoomType {
  return (ROOM_TYPE_VALUES as readonly string[]).includes(s);
}

/**
 * Debounce a function. Returns a wrapper that delays calling `fn` until
 * `waitMs` have elapsed since the last invocation. The returned function
 * also exposes a `.cancel()` method so the caller can cancel a pending
 * call (e.g. on unmount).
 *
 * Used by the search input so we don't fire a request per keystroke.
 */
export function debounce<T extends (...args: never[]) => void>(fn: T, waitMs: number): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

/**
 * Stable sort rooms by audience count (desc). Returns a NEW array — the
 * input is never mutated. Used by the "popular" feed category client-side
 * when the backend's already-sorted list needs a tie-breaker.
 */
export interface RoomSummary {
  id: number;
  audienceCount: number;
}
export function sortRoomsByAudience<T extends RoomSummary>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => b.audienceCount - a.audienceCount);
}

/**
 * De-duplicate a list of rooms by id. Keeps the FIRST occurrence (so the
 * newest fetched page wins when the same room appears in two pages).
 * Returns a NEW array.
 */
export function dedupeRoomsById<T extends { id: number }>(rooms: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of rooms) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Emoji for a room type. Falls back to 🎯 for unknown types. */
export function roomTypeIcon(type: string): string {
  switch (type) {
    case "live": return "🔴";
    case "voice": return "🎙️";
    case "party": return "🎉";
    default: return "🎯";
  }
}

/** Human-readable label for a room type. */
export function roomTypeLabel(type: string): string {
  switch (type) {
    case "live": return "Live";
    case "voice": return "Voice";
    case "party": return "Party";
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/**
 * Compact audience / likes count formatter. Mirrors the social-app
 * convention: < 1000 → exact, < 1_000_000 → "1.2k", else "12M".
 */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10}k`;
  }
  const v = n / 1_000_000;
  return `${v >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10}M`;
}

/**
 * Format a past timestamp as a relative time string ("just now", "5m ago",
 * "2h ago", "3d ago", or a date for anything older than a week).
 *
 * Accepts ISO 8601 strings (from the API) or Date objects.
 */
export function formatRelativeTime(input: string | Date, now: Date = new Date()): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  // Older than a week → "Oct 5" style
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
