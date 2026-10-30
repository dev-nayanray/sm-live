/**
 * SM Live — pure social helpers (Prompt 16).
 *
 * Pure functions used by the profile + social screens. Extracted so the
 * test suite can verify behaviour without mounting React.
 */

export type FollowState = "following" | "not_following" | "self" | "blocked";

/** Determine the follow button state from profile data. */
export function getFollowState(profile: { isFollowing: boolean; isBlocked: boolean; isSelf: boolean }): FollowState {
  if (profile.isSelf) return "self";
  if (profile.isBlocked) return "blocked";
  return profile.isFollowing ? "following" : "not_following";
}

/** Human label for the follow button based on state. */
export function followButtonLabel(state: FollowState): string {
  switch (state) {
    case "following": return "Following";
    case "not_following": return "Follow";
    case "self": return "You";
    case "blocked": return "Blocked";
  }
}

/** Format a count as "1.2k" / "12k" for follower counts. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Report reason labels. */
export const REPORT_REASONS = [
  { key: "harassment", label: "Harassment or bullying" },
  { key: "spam", label: "Spam or fake account" },
  { key: "impersonation", label: "Impersonation" },
  { key: "inappropriate_content", label: "Inappropriate content" },
  { key: "scam", label: "Scam or fraud" },
  { key: "other", label: "Other" },
] as const;

/** Check if a user can perform social actions (follow/message) — blocked users cannot. */
export function canInteract(state: FollowState): boolean {
  return state !== "blocked" && state !== "self";
}

/** Build the deep link URL for sharing a profile. */
export function buildProfileShareUrl(userId: number, baseUrl: string = "https://sm-live.app"): string {
  return `${baseUrl}/u/${userId}`;
}
