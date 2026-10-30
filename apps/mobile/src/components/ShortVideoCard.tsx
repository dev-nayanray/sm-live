/**
 * SM Live — ShortVideoCard (Prompt 15).
 *
 * Reusable card for displaying a short-video preview. The card surfaces
 * the cover image (when present), title, author (when available), likes
 * count, and a small play icon. Tapping the card opens the video detail
 * — but full-screen playback is a future prompt; today the card is a
 * discovery surface only.
 *
 * Image handling: when `coverUrl` is empty (the backend stores "" for
 * videos without a cover), the card renders a coloured placeholder with
 * the title's first letter. This matches the existing Avatar fallback
 * convention so the UI never shows a broken image.
 *
 * The card does NOT auto-play the video — auto-playing many videos in a
 * scroll would tank the data plan + battery. A future full-screen video
 * screen will handle playback.
 */
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Badge } from "./index";
import { theme, t, spacing, radius } from "../theme";
import { formatCount, formatRelativeTime } from "../hooks/feedPure";

export interface ShortVideoCardData {
  id: number;
  title?: string;
  videoUrl: string;
  coverUrl?: string;
  likes: number;
  country?: string;
  createdAt?: string;
  authorId?: number;
  authorName?: string;
}

export interface ShortVideoCardProps {
  video: ShortVideoCardData;
  style?: ViewStyle;
  /** Card width — defaults to 160 for a 3-column carousel. */
  width?: number;
}

export function ShortVideoCard({ video, style, width = 160 }: ShortVideoCardProps) {
  const hasCover = !!video.coverUrl && video.coverUrl.length > 0;
  const initial = (video.title ?? video.authorName ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <View style={[s.card, { width }, style]}>
      <View style={s.thumb}>
        {hasCover ? (
          <Image source={{ uri: video.coverUrl }} style={s.cover} />
        ) : (
          <View style={[s.placeholder, { backgroundColor: thumbColor(video.id) }]}>
            <Text style={s.placeholderText}>{initial}</Text>
          </View>
        )}
        <View style={s.overlayTop}>
          <Badge tone="primary" label="▶ video" />
        </View>
        <View style={s.overlayBottom}>
          <Text style={s.likes}>♥ {formatCount(video.likes)}</Text>
        </View>
      </View>
      <View style={s.body}>
        {video.title ? (
          <Text style={s.title} numberOfLines={2}>{video.title}</Text>
        ) : (
          <Text style={s.titleFallback} numberOfLines={1}>Video #{video.id}</Text>
        )}
        <View style={s.metaRow}>
          {video.authorName ? (
            <Text style={s.author} numberOfLines={1}>@{video.authorName}</Text>
          ) : null}
          {video.createdAt ? (
            <Text style={s.time}>{formatRelativeTime(video.createdAt)}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Stable colour for the placeholder so the same video always shows the
 *  same colour — better than random per-render. */
function thumbColor(id: number): string {
  const palette = [
    "rgba(124, 58, 237, 0.22)",
    "rgba(244, 63, 94, 0.22)",
    "rgba(245, 158, 11, 0.22)",
    "rgba(52, 211, 153, 0.22)",
    "rgba(56, 189, 248, 0.22)",
  ];
  return palette[id % palette.length] ?? palette[0]!;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  thumb: {
    height: 220,
    position: "relative",
    backgroundColor: theme.surfaceAlt,
  },
  cover: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontSize: 48,
    fontWeight: "800",
    color: theme.textMuted,
  },
  overlayTop: {
    position: "absolute",
    top: spacing[2],
    left: spacing[2],
  },
  overlayBottom: {
    position: "absolute",
    bottom: spacing[2],
    right: spacing[2],
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  likes: {
    ...t.micro,
    color: theme.textInverse,
    fontWeight: "700",
  },
  body: {
    padding: spacing[2],
    gap: spacing[1],
  },
  title: {
    ...t.caption,
    color: theme.text,
    fontWeight: "600",
    minHeight: 36,
  },
  titleFallback: {
    ...t.caption,
    color: theme.textSubtle,
    fontStyle: "italic",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  author: {
    ...t.micro,
    color: theme.primaryMuted,
    flex: 1,
  },
  time: {
    ...t.micro,
    color: theme.textSubtle,
  },
});
