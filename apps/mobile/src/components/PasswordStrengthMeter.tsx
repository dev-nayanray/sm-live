/**
 * SM Live — password strength meter (Prompt 14).
 *
 * Renders 4 segments (0-4 score from `passwordStrength`). Each segment
 * fills with the colour returned by the helper, so a "very weak" password
 * shows 1 red segment and a "strong" password shows 4 green segments.
 *
 * The label below the meter updates in lockstep — gives the user an
 * immediate, plain-English hint without making them parse the bar.
 */
import { StyleSheet, Text, View } from "react-native";
import { passwordStrength } from "../hooks/authPure";
import { theme, t, spacing } from "../theme";

export interface PasswordStrengthMeterProps {
  password: string;
  /** Hide the label below the bar (use when space is tight). */
  hideLabel?: boolean;
}

export function PasswordStrengthMeter({ password, hideLabel }: PasswordStrengthMeterProps) {
  if (!password) return null;
  const strength = passwordStrength(password);
  return (
    <View style={s.wrap}>
      <View style={s.barRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              s.segment,
              { backgroundColor: i < strength.score ? strength.color : theme.surface },
            ]}
          />
        ))}
      </View>
      {!hideLabel && (
        <Text style={[s.label, { color: strength.color }]}>
          {strength.label}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: spacing[1],
    gap: spacing[1],
  },
  barRow: {
    flexDirection: "row",
    gap: spacing[1],
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  label: {
    ...t.micro,
    fontWeight: "600",
  },
});
