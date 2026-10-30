/**
 * SM Live — Error state (Prompt 13).
 *
 * Used when an API call fails and the screen has nothing else to show.
 * Distinct from <EmptyState> (zero results) and <Loading> (in-flight):
 *
 *   Loading  → we don't know yet
 *   Empty    → we know there's nothing
 *   Error    → we couldn't find out
 *
 * The component deliberately NEVER renders the raw error.message from
 * the network layer when it might leak internals (status codes, SQL,
 * stack traces). The `message` prop should be a user-facing sentence;
 * the optional `technical` prop is rendered in a smaller monospace block
 * that admins / devs can copy from the screen but is visually de-emphasised.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface ErrorStateProps {
  /** User-facing headline, e.g. "Couldn't load rooms". */
  title: string;
  /** Optional user-facing detail. */
  subtitle?: string;
  /** Optional technical detail (e.g. network error code) — rendered small + muted. */
  technical?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function ErrorState({ title, subtitle, technical, ctaLabel, onCta }: ErrorStateProps) {
  return (
    <View style={s.wrap}>
      <Text style={s.icon}>⚠️</Text>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      {technical ? <Text style={s.technical} numberOfLines={3}>{technical}</Text> : null}
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
    fontSize: 36,
    marginBottom: spacing[1],
  },
  title: {
    ...typography.h2,
    color: theme.danger,
    textAlign: "center",
  },
  subtitle: {
    ...typography.caption,
    color: theme.textSubtle,
    textAlign: "center",
    maxWidth: 280,
  },
  technical: {
    ...typography.micro,
    color: theme.textSubtle,
    fontFamily: "monospace",
    marginTop: spacing[1],
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
