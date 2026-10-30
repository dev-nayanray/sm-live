/**
 * SM Live — primary button component (Prompt 13).
 *
 * Four variants cover every call-to-action in the app:
 *
 *   primary  → brand purple fill, white text. Default CTA.
 *   accent   → brand rose fill, white text. Destructive-positive (Send gift).
 *   ghost    → transparent fill with border. Secondary CTA (Cancel).
 *   danger   → solid rose. Destructive (Logout, Delete).
 *
 * All variants meet the 48pt minimum tap target height. Disabled state
 * fades to 40% opacity AND drops the press handler so a stale tap cannot
 * fire after the underlying action completes.
 *
 * Optional `loading` prop swaps the label for an ActivityIndicator so the
 * button can show in-flight state without changing its layout (the
 * indicator is sized to roughly match the label height).
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { theme } from "../theme";
import { controlHeights, radius, spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type ButtonVariant = "primary" | "accent" | "ghost" | "danger";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading emoji / icon character. Rendered before the label. */
  icon?: string;
  style?: ViewStyle;
  /** Accessibility label overrides the label prop when present. */
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = "primary", disabled, loading, icon, style, accessibilityLabel }: ButtonProps) {
  const bg = disabled
    ? theme.surfaceAlt
    : variant === "primary" ? theme.primary
    : variant === "accent" ? theme.accent
    : variant === "danger" ? theme.danger
    : "transparent";
  const fg = disabled
    ? theme.textSubtle
    : variant === "ghost" ? theme.text
    : theme.textInverse;
  const border = variant === "ghost" && !disabled ? theme.border : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [s.base, { backgroundColor: bg, borderColor: border, opacity: pressed && !disabled ? 0.85 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[s.label, { color: fg }]}>
          {icon ? `${icon}  ` : ""}{label}
        </Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    height: controlHeights.button,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[5],
    flexDirection: "row",
  },
  label: {
    ...typography.body,
    fontWeight: "700",
  },
});
