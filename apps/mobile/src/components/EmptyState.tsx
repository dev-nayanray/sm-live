/**
 * SM Live — Empty state (Prompt 13).
 *
 * Used by every screen / section that can legitimately have zero rows:
 * no rooms yet, no conversations, no transactions, no search results.
 *
 * The visual is intentionally minimal — a large emoji, a short headline,
 * an optional supporting line, and an optional CTA. The CTA is a plain
 * Pressable (not a Button) so callers can style it inline if they want
 * a smaller "dismiss" rather than a hero CTA.
 *
 * Empty states should NEVER be fake — if the API hasn't returned data
 * yet, show this. If the API errored, show <ErrorState> instead.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function EmptyState({ icon, title, subtitle, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <View style={s.wrap}>
      {icon ? <Text style={s.icon}>{icon}</Text> : null}
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      {ctaLabel && onCta ? (
        <Pressable style={s.cta} onPress={onCta}>
          <Text style={s.ctaLabel}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[5],
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  icon: {
    fontSize: 44,
    marginBottom: spacing[1],
  },
  title: {
    ...typography.h2,
    color: theme.text,
    textAlign: "center",
  },
  subtitle: {
    ...typography.caption,
    color: theme.textSubtle,
    textAlign: "center",
    maxWidth: 280,
  },
  cta: {
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: theme.primary,
  },
  ctaLabel: {
    color: theme.textInverse,
    ...typography.caption,
    fontWeight: "700",
  },
});
