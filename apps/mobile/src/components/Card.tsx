/**
 * SM Live — Card surface (Prompt 13).
 *
 * A rounded elevated surface used to group related content. The card
 * itself is presentation only — it does NOT impose internal padding so a
 * caller can place a full-bleed image at the top with text below.
 *
 * Variants:
 *   default  → solid surface fill + 1px border
 *   flat     → no border, transparent fill (for nested groupings)
 *   hero     → primary-tinted fill (for balance / VIP cards)
 *
 * Optional `title` renders a styled header above the body; optional
 * `action` renders a small chip on the right of the title (e.g. "see all →").
 */
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { theme } from "../theme";
import { radius, spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface CardProps {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  variant?: "default" | "flat" | "hero";
  style?: ViewStyle;
  /** Padding override — defaults to 16. Pass 0 for full-bleed content. */
  pad?: number;
}

export function Card({ children, title, action, variant = "default", style, pad = spacing[4] }: CardProps) {
  const fill =
    variant === "hero" ? "rgba(124, 58, 237, 0.18)"
    : variant === "flat" ? "transparent"
    : theme.surface;
  const border = variant === "flat" ? "transparent" : theme.border;
  return (
    <View style={[s.base, { backgroundColor: fill, borderColor: border, padding: pad }, style]}>
      {(title || action) && (
        <View style={s.header}>
          {title && <Text style={s.title} numberOfLines={1}>{title}</Text>}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  title: {
    ...typography.h2,
    color: theme.text,
    flex: 1,
  },
});
