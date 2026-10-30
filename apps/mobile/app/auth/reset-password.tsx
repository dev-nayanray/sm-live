import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { api, ApiError } from "../../src/api/client";
import {
  Button, Input, PasswordInput, PasswordStrengthMeter, theme, t, spacing,
} from "../../src/components";
import { validatePassword, validatePasswordMatch } from "../../src/hooks/authPure";

/**
 * SM Live — Reset password screen (Prompt 14).
 *
 * Final step of the password-reset flow. Requires:
 *   - The reset token (auto-filled from the forgot-password screen's
 *     `devToken` query param when present; the user can also paste it
 *     manually — needed for production where the token arrives via
 *     email/SMS, not the query string).
 *   - A new password that meets the same rules as registration.
 *   - A confirmation that matches.
 *
 * On success, the backend revokes every existing session for the user
 * (including the one that was used to navigate to the forgot-password
 * screen). The screen routes the user back to login so they can sign
 * in with the new password.
 *
 * On failure (expired / consumed / unknown token), the backend returns
 * 401 with a specific message; the screen surfaces it inline.
 */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy) return;
    setFormError(null);
    if (token.trim().length < 16) return setFormError("Enter the reset code we sent you");
    const pw = validatePassword(password);
    if (!pw.ok) return setFormError(pw.message);
    const match = validatePasswordMatch(password, confirm);
    if (!match.ok) return setFormError(match.message);

    setBusy(true);
    try {
      await api("/v1/auth/password/reset-confirm", {
        method: "POST",
        json: { token: token.trim(), password },
      });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.message);
      } else {
        setFormError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <ScrollView contentContainerStyle={s.root}>
        <View style={s.doneCard}>
          <Text style={s.doneIcon}>✅</Text>
          <Text style={s.doneTitle}>Password updated</Text>
          <Text style={s.doneBody}>
            Your password has been changed and we've signed you out of every other device for security.
          </Text>
          <Button label="Sign in" onPress={() => router.replace("/auth/login")} style={s.continueBtn} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>Set a new password</Text>
        <Text style={s.sub}>
          Choose a password you haven't used before. We'll sign you out everywhere else after the change.
        </Text>
      </View>

      <View style={s.form}>
        <Input
          label="Reset code"
          value={token}
          onChangeText={(v) => { setToken(v); if (formError) setFormError(null); }}
          placeholder="Paste the code from your email or SMS"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={2}
          style={s.tokenInput}
        />
        <View style={s.fieldGap}>
          <PasswordInput
            label="New password"
            value={password}
            onChangeText={(v) => { setPassword(v); if (formError) setFormError(null); }}
            placeholder="At least 6 characters"
            returnKeyType="next"
          />
          <PasswordStrengthMeter password={password} />
        </View>
        <View style={s.fieldGap}>
          <PasswordInput
            label="Confirm new password"
            value={confirm}
            onChangeText={(v) => { setConfirm(v); if (formError) setFormError(null); }}
            placeholder="Re-enter your new password"
            returnKeyType="go"
            errorText={confirm && password !== confirm ? "Passwords do not match" : null}
          />
        </View>

        {formError ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{formError}</Text>
          </View>
        ) : null}

        <View style={s.fieldGap}>
          <Button label="Update password" onPress={submit} loading={busy} disabled={busy} />
        </View>
      </View>

      <View style={s.footer}>
        <Pressable onPress={() => router.back()}>
          <Text style={s.footerLink}>← Back</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    flexGrow: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[6],
    justifyContent: "space-between",
  },
  head: {
    marginTop: spacing[6],
    gap: spacing[1],
  },
  title: {
    ...t.h1,
    color: theme.text,
  },
  sub: {
    ...t.caption,
    color: theme.textSubtle,
    lineHeight: 20,
  },
  form: {
    marginTop: spacing[5],
    gap: spacing[2],
  },
  fieldGap: {
    marginTop: spacing[3],
  },
  tokenInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  errorBox: {
    backgroundColor: "rgba(251, 113, 133, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
    borderRadius: 4,
  },
  errorText: {
    ...t.caption,
    color: theme.danger,
  },
  footer: {
    alignItems: "center",
    marginTop: spacing[6],
  },
  footerLink: {
    ...t.caption,
    color: theme.textSubtle,
  },
  doneCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing[5],
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[8],
  },
  doneIcon: { fontSize: 44 },
  doneTitle: {
    ...t.h1,
    color: theme.success,
  },
  doneBody: {
    ...t.body,
    color: theme.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  continueBtn: {
    marginTop: spacing[2],
    alignSelf: "stretch",
  },
});
