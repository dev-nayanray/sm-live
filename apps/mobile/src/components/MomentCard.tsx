/**
 * SM Live — MomentCard (Prompt 15).
 *
 * Reusable card for displaying a "moment" — a short text + optional
 * image post from a creator. Used in the Home + Discover feeds.
 *
 * The card surfaces: text (or a fallback when empty), optional image
 * (when imageUrl is non-empty), likes count, creation time.
 *
 * Image handling: when `imageUrl` is empty, the card collapses to a
 * text-only layout (no broken image icon). When present, the image is
 * rendered at a fixed height with `resizeMode: "cover"` so the card
 * keeps a consistent aspect ratio regardless of source dimensions.
 */
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { theme, t, spacing, radius } from "../theme";
import { formatCount, formatRelativeTime } from "../hooks/feedPure";

export interface MomentCardData {
  id: number;
  text: string;
  imageUrl?: string;
  likes: number;
  country?: string;
  createdAt?: string;
  authorId?: number;
  authorName?: string;
}

export interface MomentCardProps {
  moment: MomentCardData;
  style?: ViewStyle;
}

export function MomentCard({ moment, style }: MomentCardProps) {
  const hasImage = !!moment.imageUrl && moment.imageUrl.length > 0;
  return (
    <View style={[s.card, style]}>
      {hasImage && (
        <Image source={{ uri: moment.imageUrl }} style={s.image} />
      )}
      <View style={s.body}>
        {moment.text ? (
          <Text style={s.text} numberOfLines={4}>{moment.text}</Text>
        ) : (
          <Text style={s.textFallback}>Moment #{moment.id}</Text>
        )}
        <View style={s.metaRow}>
          <Text style={s.likes}>♥ {formatCount(moment.likes)}</Text>
          {moment.authorName ? (
            <Text style={s.author} numberOfLines={1}>@{moment.authorName}</Text>
          ) : null}
          {moment.createdAt ? (
            <Text style={s.time}>{formatRelativeTime(moment.createdAt)}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: 160,
    resizeMode: "cover",
    backgroundColor: theme.surfaceAlt,
  },
  body: {
    padding: spacing[3],
    gap: spacing[2],
  },
  text: {
    ...t.body,
    color: theme.text,
    lineHeight: 21,
  },
  textFallback: {
    ...t.body,
    color: theme.textSubtle,
    fontStyle: "italic",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  likes: {
    ...t.caption,
    color: theme.accent,
    fontWeight: "700",
  },
  author: {
    ...t.caption,
    color: theme.primaryMuted,
    flex: 1,
  },
  time: {
    ...t.micro,
    color: theme.textSubtle,
  },
});
