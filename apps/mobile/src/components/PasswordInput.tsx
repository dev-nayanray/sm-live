/**
 * SM Live — password input (Prompt 14).
 *
 * TextInput wrapper with a show/hide toggle. Built on the design-system
 * Input component so it inherits the height / radius / typography tokens.
 *
 * The eye icon is a single character (👁 / 🙈) — keeps the bundle small
 * (no SVG icon set for this one control) and renders consistently across
 * Android versions.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { Input, type InputProps } from "./Input";
import { theme } from "../theme";
import { spacing } from "../theme/spacing";

export interface PasswordInputProps extends Omit<InputProps, "secureTextEntry"> {
  /** Override the default "show / hide" labels for accessibility. */
  showLabel?: string;
  hideLabel?: string;
}

export function PasswordInput({ showLabel = "show", hideLabel = "hide", style, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={s.wrap}>
      <Input
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        style={[s.inputWithIcon, style]}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? hideLabel : showLabel}
        style={s.eye}
      >
        <Text style={s.eyeIcon}>{visible ? "🙈" : "👁"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "relative" },
  inputWithIcon: { paddingRight: 48 },
  eye: {
    position: "absolute",
    right: spacing[2],
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: spacing[2],
  },
  eyeIcon: { fontSize: 18, color: theme.textMuted },
});
