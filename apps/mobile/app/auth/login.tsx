import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useAuth } from "../../src/state/AppProviders";
import { ApiError } from "../../src/api/client";
import { Button, Input, PasswordInput, theme, t, spacing } from "../../src/components";
import { validateIdentifier, validatePassword } from "../../src/hooks/authPure";

/**
 * SM Live — Login screen (Prompt 14).
 *
 * Rewritten from the original to use the design-system tokens + the
 * enhanced AppProviders auth state machine. New features:
 *   - Inline validation (identifier + password) before submit.
 *   - Show/hide password toggle.
 *   - Distinguishes "invalid credentials" (401) from "account banned"
 *     (403) so the user gets the right message + a link to support.
 *   - Forgot password link → /auth/forgot-password.
 *   - OTP login link → /auth/otp.
 *   - Duplicate-submit guard (the AppProviders.inflight flag short-
 *     circuits a second tap on the Sign in button).
 *   - After successful login, the AppProviders state flips to
 *     "authenticated" and app/index.tsx routes to the tabs.
 */
export default function Login() {
  const { login, status, error, clearError } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const busy = status === "authenticating";

  const validate = (): string | null => {
    const id = validateIdentifier(identifier);
    if (!id.ok) return id.message;
    const pw = validatePassword(password);
    if (!pw.ok) return pw.message;
    return null;
  };

  const submit = async () => {
    if (busy) return;
    clearError();
    setFormError(null);
    const v = validate();
    if (v) {
      setFormError(v);
      return;
    }
    try {
      await login(identifier.trim(), password);
      // Success — AppProviders flips status to "authenticated"; the
      // index.tsx gate will route to the tabs. No explicit router.replace
      // here so the gate logic stays the single source of truth.
    } catch (e) {
      // AppProviders already set the error; surface it inline.
      if (e instanceof ApiError && e.code === "forbidden") {
        setFormError("Your account is suspended or banned. Contact support if you think this is a mistake.");
      } else {
        setFormError((e as Error).message);
      }
    }
  };

  const shownError = formError ?? error;

  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.brand}>SM Live</Text>
        <Text style={s.sub}>Welcome back</Text>
      </View>

      <View style={s.form}>
        <Input
          label="Phone or email"
          value={identifier}
          onChangeText={(v) => { setIdentifier(v); if (formError) setFormError(null); if (error) clearError(); }}
          placeholder="+880170000001 or you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <View style={s.fieldGap}>
          <PasswordInput
            label="Password"
            value={password}
            onChangeText={(v) => { setPassword(v); if (formError) setFormError(null); if (error) clearError(); }}
            placeholder="Your password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </View>

        <Pressable style={s.forgotRow} onPress={() => router.push("/auth/forgot-password")}>
          <Text style={s.forgotText}>Forgot password?</Text>
        </Pressable>

        {shownError ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{shownError}</Text>
          </View>
        ) : null}

        <View style={s.fieldGap}>
          <Button label="Sign in" onPress={submit} loading={busy} disabled={busy} />
        </View>

        <View style={s.dividerRow}>
          <View style={s.divider} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.divider} />
        </View>

        <Pressable style={s.altRow} onPress={() => router.push("/auth/otp")}>
          <Text style={s.altIcon}>📲</Text>
          <Text style={s.altText}>Sign in with OTP</Text>
        </Pressable>
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>New to SM Live?</Text>
        <Pressable onPress={() => router.push("/auth/register")}>
          <Text style={s.footerLink}>Create an account →</Text>
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
    alignItems: "center",
    marginTop: spacing[6],
    gap: spacing[1],
  },
  brand: {
    ...t.display,
    color: theme.primaryMuted,
    letterSpacing: 4,
  },
  sub: {
    ...t.body,
    color: theme.textSubtle,
  },
  form: {
    marginTop: spacing[6],
    gap: spacing[2],
  },
  fieldGap: {
    marginTop: spacing[3],
  },
  forgotRow: {
    alignSelf: "flex-end",
    marginTop: spacing[2],
    paddingVertical: spacing[1],
  },
  forgotText: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginVertical: spacing[3],
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.border,
  },
  dividerText: {
    ...t.caption,
    color: theme.textSubtle,
  },
  altRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
  },
  altIcon: { fontSize: 18 },
  altText: {
    ...t.body,
    color: theme.text,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[6],
  },
  footerText: {
    ...t.caption,
    color: theme.textSubtle,
  },
  footerLink: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "700",
  },
});
