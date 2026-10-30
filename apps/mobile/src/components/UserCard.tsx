/**
 * SM Live — UserCard (Prompt 15).
 *
 * Reusable card for displaying a public user profile preview. Two
 * layouts:
 *
 *   - "grid" (default): 140pt-wide card for horizontal carousels
 *     (recommended creators, search results). Avatar + name + VIP/noble
 *     badges + "View profile" hint.
 *   - "list": full-width card for vertical lists (search results,
 *     followers — when a follow graph lands). Adds the country + join
 *     date.
 *
 * The card surfaces ONLY public fields: displayName, avatarUrl,
 * vipLevel, nobleLevel, country, createdAt. Phone and email are NEVER
 * returned by /v1/users/search (the route doesn't even select them),
 * so the card has no way to leak them.
 *
 * Follow button: NOT rendered. The platform has no follow backend yet
 * — surfacing a non-functional Follow button would be fake
 * functionality. When a follow backend lands, add a `following: boolean`
 * prop + an onFollow callback here.
 */
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Avatar, Badge } from "./index";
import { theme, t, spacing, radius } from "../theme";
import { formatRelativeTime } from "../hooks/feedPure";

export interface UserCardData {
  id: number;
  displayName: string;
  avatarUrl?: string;
  vipLevel?: number;
  nobleLevel?: number;
  country?: string;
  createdAt?: string;
  /** Optional: number of followers. Surfaced only if the backend returns it. */
  followerCount?: number;
}

export interface UserCardProps {
  user: UserCardData;
  variant?: "grid" | "list";
  style?: ViewStyle;
}

export function UserCard({ user, variant = "grid", style }: UserCardProps) {
  const isGrid = variant === "grid";
  return (
    <View style={[isGrid ? s.grid : s.list, style]}>
      <View style={isGrid ? s.gridTop : s.listTop}>
        <Avatar
          name={user.displayName}
          imageUrl={user.avatarUrl}
          size={isGrid ? 56 : 48}
          vipLevel={user.vipLevel}
        />
        <View style={isGrid ? s.gridInfo : s.listInfo}>
          <Text style={[s.name, isGrid && s.nameCenter]} numberOfLines={1}>{user.displayName}</Text>
          <View style={s.badges}>
            {user.vipLevel ? <Badge tone="vip" label={`VIP${user.vipLevel}`} /> : null}
            {user.nobleLevel ? <Badge tone="noble" label={`N${user.nobleLevel}`} /> : null}
            {user.country ? <Badge tone="muted" label={user.country} icon="🌍" /> : null}
          </View>
        </View>
      </View>
      <View style={s.bottom}>
        {typeof user.followerCount === "number" && (
          <Text style={s.meta}>{formatFollowers(user.followerCount)} followers</Text>
        )}
        {!isGrid && user.createdAt && (
          <Text style={s.meta}>joined {formatRelativeTime(user.createdAt)}</Text>
        )}
        {isGrid && (
          <Text style={s.viewHint}>View profile →</Text>
        )}
      </View>
    </View>
  );
}

function formatFollowers(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const s = StyleSheet.create({
  grid: {
    width: 140,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[3],
    gap: spacing[2],
    alignItems: "center",
  },
  list: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[3],
  },
  gridTop: {
    alignItems: "center",
    gap: spacing[2],
  },
  listTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  gridInfo: {
    alignItems: "center",
    gap: spacing[1],
  },
  listInfo: {
    flex: 1,
    gap: spacing[1],
  },
  name: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  nameCenter: {
    textAlign: "center",
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
    justifyContent: "center",
  },
  bottom: {
    alignItems: "center",
    gap: spacing[1],
  },
  meta: {
    ...t.micro,
    color: theme.textSubtle,
  },
  viewHint: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
});
