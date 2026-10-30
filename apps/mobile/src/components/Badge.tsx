/**
 * SM Live — Badge (Prompt 13).
 *
 * A compact pill used to flag a single attribute next to a label or row
 * (e.g. room type "LIVE", VIP level "VIP3", gift category "luxury").
 *
 * Tones map to the design-system palette:
 *   primary  → brand purple (default)
 *   accent   → brand rose
 *   success  → green
 *   warning  → amber
 *   danger   → red
 *   vip      → gold
 *   noble    → royal purple
 *   muted    → neutral slate
 */
import { StyleSheet, Text, View } from "react-native";
import { theme, type Palette } from "../theme";
import { radius, spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type BadgeTone = "primary" | "accent" | "success" | "warning" | "danger" | "vip" | "noble" | "muted";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** Optional leading emoji (e.g. "🔴" for live). */
  icon?: string;
}

const TONE_BG: Record<BadgeTone, keyof Palette> = {
  primary: "primary",
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  vip: "vip",
  noble: "noble",
  muted: "surface",
};

export function Badge({ label, tone = "primary", icon }: BadgeProps) {
  const bgKey = TONE_BG[tone];
  const bg = theme[bgKey];
  const isMuted = tone === "muted";
  const fg = isMuted ? theme.textMuted : theme.textInverse;
  return (
    <View style={[s.wrap, { backgroundColor: bg }]}>
      <Text style={[s.label, { color: fg }]}>
        {icon ? `${icon} ` : ""}{label}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  label: {
    ...typography.micro,
    textTransform: "uppercase",
  },
});
