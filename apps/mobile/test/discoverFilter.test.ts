import { filterRooms, type DiscoverRoom } from "../src/hooks/discoverPure";

/**
 * Discover screen data transforms (Prompt 13).
 *
 * The Discover screen filters an already-fetched list of rooms locally
 * since the backend doesn't yet expose /v1/search. The filter is
 * extracted into a pure function so the test suite can verify behaviour
 * without mounting any React components.
 */

const rooms: DiscoverRoom[] = [
  { id: 1, title: "Late Night Vibes", type: "voice", country: "BD", audienceCount: 12, host: { id: 1, displayName: "Alice", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
  { id: 2, title: "PK Battle Arena", type: "live", country: "BD", audienceCount: 5, host: { id: 2, displayName: "Bob", avatarUrl: "", vipLevel: 3, nobleLevel: 1 } },
  { id: 3, title: "Party House", type: "party", country: "IN", audienceCount: 9, host: { id: 3, displayName: "Carol", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
  { id: 4, title: "Crash X gameplay", type: "live", country: "BD", audienceCount: 0, host: { id: 4, displayName: "Dave", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
];

describe("discover filter", () => {
  it("returns every room when the query is empty", () => {
    expect(filterRooms(rooms, "")).toHaveLength(4);
    expect(filterRooms(rooms, "   ")).toHaveLength(4);
  });

  it("matches by title case-insensitively", () => {
    expect(filterRooms(rooms, "party")).toHaveLength(1);
    expect(filterRooms(rooms, "PARTY")).toHaveLength(1);
    expect(filterRooms(rooms, "vibes")).toHaveLength(1);
  });

  it("matches by host display name", () => {
    expect(filterRooms(rooms, "alice")).toHaveLength(1);
    expect(filterRooms(rooms, "Bob")).toHaveLength(1);
  });

  it("matches by room type", () => {
    expect(filterRooms(rooms, "voice")).toHaveLength(1);
    expect(filterRooms(rooms, "live")).toHaveLength(2);
  });

  it("returns no rows when nothing matches", () => {
    expect(filterRooms(rooms, "nonexistent")).toHaveLength(0);
  });

  it("trims whitespace before matching", () => {
    expect(filterRooms(rooms, "  party  ")).toHaveLength(1);
  });

  it("does not mutate the input array", () => {
    const original = [...rooms];
    filterRooms(rooms, "party");
    expect(rooms).toEqual(original);
  });
});
