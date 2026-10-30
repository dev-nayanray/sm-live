/**
 * SM Live — pure helpers for the Discover screen (Prompt 13).
 *
 * Extracted so the filter logic is unit-testable without mounting any
 * React components. The Discover screen imports `filterRooms` and uses
 * it on the already-fetched room list.
 */
export interface DiscoverRoom {
  id: number;
  title: string;
  type: string;
  country: string;
  audienceCount: number;
  host: {
    id: number;
    displayName: string;
    avatarUrl: string;
    vipLevel: number;
    nobleLevel: number;
  };
}

/**
 * Filter a list of rooms by a free-text query. Matches against the
 * room title, host display name, and room type — all case-insensitive.
 *
 * Returns the original list (by reference, NOT a copy) when the query
 * is empty / whitespace so callers can short-circuit the filter pass.
 * When the query is non-empty, returns a NEW filtered array — the input
 * array is never mutated.
 */
export function filterRooms(rooms: DiscoverRoom[], query: string): DiscoverRoom[] {
  const q = query.trim().toLowerCase();
  if (!q) return rooms;
  return rooms.filter((r) =>
    r.title.toLowerCase().includes(q) ||
    r.host.displayName.toLowerCase().includes(q) ||
    r.type.toLowerCase().includes(q));
}
