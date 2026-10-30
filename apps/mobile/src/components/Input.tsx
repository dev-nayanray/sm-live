/**
 * SM Live — text input (Prompt 13).
 *
 * Wraps TextInput with the design-system tokens so every input across the
 * app looks identical. The input is uncontrolled by default — callers
 * pass `value` + `onChangeText` like a vanilla TextInput — but exposes
 * `errorText` to flip the border to the danger color and render a helper
 * message below the field.
 *
 * Why a wrapper rather than re-exporting TextInput: the wrapper bakes in
 * the right height, color, radius, and placeholder color so screens can't
 * drift. Future enhancements (e.g. floating label, icon prefix) can land
 * here once instead of in every screen.
 */
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { theme } from "../theme";
import { controlHeights, radius, spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface InputProps extends TextInputProps {
  errorText?: string | null;
  /** Optional helper text shown below the field when there is no error. */
  helper?: string;
  /** Optional label rendered above the input. */
  label?: string;
}

export function Input({ errorText, helper, label, style, ...rest }: InputProps) {
  return (
    <View>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        {...rest}
        placeholderTextColor={theme.textSubtle}
        style={[s.input, errorText && s.inputError, style]}
      />
      {errorText ? (
        <Text style={s.error}>{errorText}</Text>
      ) : helper ? (
        <Text style={s.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  label: {
    ...typography.caption,
    color: theme.textSubtle,
    marginBottom: spacing[1],
  },
  input: {
    height: controlHeights.input,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: spacing[3],
    ...typography.body,
  },
  inputError: {
    borderColor: theme.danger,
  },
  error: {
    ...typography.caption,
    color: theme.danger,
    marginTop: spacing[1],
  },
  helper: {
    ...typography.caption,
    color: theme.textSubtle,
    marginTop: spacing[1],
  },
});
