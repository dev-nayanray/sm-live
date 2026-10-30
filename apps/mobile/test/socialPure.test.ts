import {
  getFollowState, followButtonLabel, formatCount, REPORT_REASONS,
  canInteract, buildProfileShareUrl,
} from "../src/hooks/socialPure";

describe("getFollowState", () => {
  it("returns 'self' when isSelf", () => {
    expect(getFollowState({ isFollowing: false, isBlocked: false, isSelf: true })).toBe("self");
  });
  it("returns 'blocked' when isBlocked", () => {
    expect(getFollowState({ isFollowing: false, isBlocked: true, isSelf: false })).toBe("blocked");
  });
  it("returns 'following' when isFollowing", () => {
    expect(getFollowState({ isFollowing: true, isBlocked: false, isSelf: false })).toBe("following");
  });
  it("returns 'not_following' when none of the above", () => {
    expect(getFollowState({ isFollowing: false, isBlocked: false, isSelf: false })).toBe("not_following");
  });
  it("blocked takes priority over following", () => {
    expect(getFollowState({ isFollowing: true, isBlocked: true, isSelf: false })).toBe("blocked");
  });
  it("self takes priority over blocked", () => {
    expect(getFollowState({ isFollowing: true, isBlocked: true, isSelf: true })).toBe("self");
  });
});

describe("followButtonLabel", () => {
  it("returns correct label for each state", () => {
    expect(followButtonLabel("following")).toBe("Following");
    expect(followButtonLabel("not_following")).toBe("Follow");
    expect(followButtonLabel("self")).toBe("You");
    expect(followButtonLabel("blocked")).toBe("Blocked");
  });
});

describe("formatCount", () => {
  it("formats under 1000 as exact", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });
  it("formats thousands as 1.2k", () => {
    expect(formatCount(1000)).toBe("1.0k");
    expect(formatCount(1200)).toBe("1.2k");
  });
  it("formats millions as 1.2M", () => {
    expect(formatCount(1_000_000)).toBe("1.0M");
    expect(formatCount(1_200_000)).toBe("1.2M");
  });
});

describe("REPORT_REASONS", () => {
  it("includes 6 reasons", () => {
    expect(REPORT_REASONS).toHaveLength(6);
  });
  it("has key + label for each", () => {
    for (const r of REPORT_REASONS) {
      expect(r.key).toBeTruthy();
      expect(r.label).toBeTruthy();
    }
  });
});

describe("canInteract", () => {
  it("true for following + not_following", () => {
    expect(canInteract("following")).toBe(true);
    expect(canInteract("not_following")).toBe(true);
  });
  it("false for self + blocked", () => {
    expect(canInteract("self")).toBe(false);
    expect(canInteract("blocked")).toBe(false);
  });
});

describe("buildProfileShareUrl", () => {
  it("builds correct URL", () => {
    expect(buildProfileShareUrl(42)).toBe("https://sm-live.app/u/42");
    expect(buildProfileShareUrl(42, "https://custom.app")).toBe("https://custom.app/u/42");
  });
});
