/**
 * SM Live — Section header (Prompt 13).
 *
 * A consistent header for sections within a screen. The existing Home
 * screen rendered its own <Text> for section titles; centralising here
 * keeps the typography + spacing identical everywhere and gives the
 * design system a single source of truth.
 *
 * Optional `action` is rendered as a small Pressable on the right side
 * (e.g. "see all →", "manage →"). When the action is a navigation
 * target, prefer passing a `<Link href="..." asChild>` element so the
 * press region covers the whole chip.
 */
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface SectionHeaderProps {
  title: string;
  /** Optional emoji prefix (e.g. "🔴" for live rooms). */
  icon?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, icon, action }: SectionHeaderProps) {
  return (
    <View style={s.wrap}>
      <Text style={s.title} numberOfLines={1}>
        {icon ? `${icon}  ` : ""}{title}
      </Text>
      {action}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    marginTop: spacing[5],
    marginBottom: spacing[2],
    gap: spacing[2],
  },
  title: {
    ...typography.h2,
    color: theme.text,
    flex: 1,
  },
});
