/**
 * SM Live — RoomCard (Prompt 15).
 *
 * Reusable card for displaying a live / voice / party room. Two layouts:
 *
 *   - "grid" (default): 200pt-wide card for horizontal carousels. Shows
 *     a coloured thumbnail block (no real image — the backend doesn't
 *     store room thumbnails), room type badge, title, host avatar +
 *     name, audience count.
 *   - "list": full-width card for vertical lists (search results,
 *     popular rooms). Adds the country + creation time.
 *
 * The card is intentionally presentation-only — it doesn't navigate
 * itself. The caller wraps it in a <Link> / <Pressable> so navigation
 * stays centralised in the screen.
 *
 * The `closed` flag renders a "Closed" badge + greys out the card so a
 * stale list never misleads the user into thinking a closed room is
 * joinable. (The /v1/feed/home endpoint filters closedAt=null server-
 * side, but the search endpoint also returns open rooms only — this is
 * a defence-in-depth check for the moment a future list surface
 * includes closed rooms.)
 */
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Avatar, Badge } from "./index";
import { theme, t, spacing, radius } from "../theme";
import { roomTypeIcon, roomTypeLabel, formatCount, formatRelativeTime } from "../hooks/feedPure";

export interface RoomCardData {
  id: number;
  title: string;
  type: string;
  country: string;
  audienceCount: number;
  closed?: boolean;
  createdAt?: string;
  host: {
    id: number;
    displayName: string;
    avatarUrl?: string;
    vipLevel?: number;
    nobleLevel?: number;
  };
}

export interface RoomCardProps {
  room: RoomCardData;
  variant?: "grid" | "list";
  style?: ViewStyle;
}

export function RoomCard({ room, variant = "grid", style }: RoomCardProps) {
  const isGrid = variant === "grid";
  const tone: "accent" | "primary" | "warning" = room.type === "live" ? "accent" : room.type === "party" ? "warning" : "primary";
  return (
    <View style={[isGrid ? s.grid : s.list, room.closed && s.closed, style]}>
      {/* Thumbnail block — coloured by room type so the card has visual
          weight even without a real image. The backend stores no room
          thumbnails today; this is a clean integration point. */}
      <View style={[s.thumb, { backgroundColor: thumbColor(room.type) }]}>
        <Text style={s.thumbIcon}>{roomTypeIcon(room.type)}</Text>
        <View style={s.thumbBadgeRow}>
          {room.type === "live" && !room.closed && (
            <Badge tone="accent" label="LIVE" icon="🔴" />
          )}
          {room.closed && <Badge tone="muted" label="CLOSED" />}
        </View>
      </View>

      <View style={s.body}>
        <View style={s.headerRow}>
          <Badge tone={tone} label={roomTypeLabel(room.type)} />
          {!isGrid && (
            <Text style={s.meta}>🌍 {room.country} · 👥 {formatCount(room.audienceCount)}</Text>
          )}
        </View>
        <Text style={s.title} numberOfLines={isGrid ? 2 : 1}>{room.title}</Text>
        <View style={s.hostRow}>
          <Avatar name={room.host.displayName} imageUrl={room.host.avatarUrl} size={isGrid ? 28 : 32} vipLevel={room.host.vipLevel} />
          <View style={s.hostInfo}>
            <Text style={s.hostName} numberOfLines={1}>{room.host.displayName}</Text>
            {room.host.vipLevel ? <Badge tone="vip" label={`VIP${room.host.vipLevel}`} /> : null}
          </View>
          {!isGrid && room.createdAt && (
            <Text style={s.time}>{formatRelativeTime(room.createdAt)}</Text>
          )}
        </View>
        {isGrid && (
          <Text style={s.meta}>👥 {formatCount(room.audienceCount)} · 🌍 {room.country}</Text>
        )}
      </View>
    </View>
  );
}

/** Colour for the thumbnail block — keyed by room type so cards in a
 *  carousel are visually distinct. */
function thumbColor(type: string): string {
  switch (type) {
    case "live": return "rgba(244, 63, 94, 0.18)";
    case "voice": return "rgba(124, 58, 237, 0.18)";
    case "party": return "rgba(245, 158, 11, 0.18)";
    default: return theme.surfaceAlt;
  }
}

const s = StyleSheet.create({
  grid: {
    width: 200,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  list: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  closed: {
    opacity: 0.55,
  },
  thumb: {
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  thumbIcon: { fontSize: 38 },
  thumbBadgeRow: {
    position: "absolute",
    top: spacing[2],
    left: spacing[2],
    flexDirection: "row",
    gap: spacing[1],
  },
  body: {
    padding: spacing[3],
    gap: spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  title: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
    minHeight: 22,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  hostInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  hostName: {
    ...t.caption,
    color: theme.textMuted,
    flex: 1,
  },
  time: {
    ...t.micro,
    color: theme.textSubtle,
  },
  meta: {
    ...t.micro,
    color: theme.textSubtle,
  },
});
