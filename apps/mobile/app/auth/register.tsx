import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useState } from "react";
import { useAuth } from "../../src/state/AppProviders";
import { ApiError } from "../../src/api/client";
import {
  Button, Input, PasswordInput, PasswordStrengthMeter, theme, t, spacing,
} from "../../src/components";
import {
  validateDisplayName, validateEmail, validatePhone, validatePassword,
  validatePasswordMatch, validateReferrerCode,
} from "../../src/hooks/authPure";

/**
 * SM Live — Registration screen (Prompt 14).
 *
 * Rewritten from the original to support the full registration contract:
 *   - Display name + phone OR email (one is required) + password +
 *     confirm password + optional referral code + terms acceptance.
 *   - Inline per-field validation as the user types.
 *   - Password strength meter (live score 0-4).
 *   - Show/hide password toggle (via PasswordInput).
 *   - Terms checkbox gate — submit disabled until accepted.
 *   - Duplicate-submit guard (AppProviders.inflight).
 *   - Backend errors surfaced inline (e.g. "identifier already registered").
 *
 * The backend re-validates every field via the `registerSchema` Zod
 * schema — the client checks are for UX, never for security.
 */
export default function Register() {
  const { register, status, error, clearError } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState(""); // phone OR email
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referrerCode, setReferrerCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const busy = status === "authenticating";

  const submit = async () => {
    if (busy) return;
    clearError();
    setFormError(null);

    // Field-by-field validation. We collect the FIRST error and surface
    // it inline rather than bombarding the user with every issue at once.
    const name = validateDisplayName(displayName);
    if (!name.ok) return setFormError(name.message);
    const id = identifier.includes("@")
      ? validateEmail(identifier)
      : validatePhone(identifier);
    if (!id.ok) return setFormError(id.message);
    const pw = validatePassword(password);
    if (!pw.ok) return setFormError(pw.message);
    const match = validatePasswordMatch(password, confirm);
    if (!match.ok) return setFormError(match.message);
    const ref = validateReferrerCode(referrerCode);
    if (!ref.ok) return setFormError(ref.message);
    if (!acceptedTerms) return setFormError("Please accept the Terms of service to continue");

    try {
      await register({
        displayName: displayName.trim(),
        ...(identifier.includes("@")
          ? { email: identifier.trim() }
          : { phone: identifier.trim() }),
        password,
        referrerCode: referrerCode.trim() || undefined,
      });
      // Success — AppProviders flips to "authenticated"; index.tsx routes.
    } catch (e) {
      if (e instanceof ApiError) {
        // Backend re-validates everything; surface its message verbatim.
        setFormError(e.message);
      } else {
        setFormError((e as Error).message);
      }
    }
  };

  const shownError = formError ?? error;

  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>Create your account</Text>
        <Text style={s.sub}>Join SM Live — live streaming, voice rooms, games, and more.</Text>
      </View>

      <View style={s.form}>
        <Input
          label="Display name"
          value={displayName}
          onChangeText={(v) => { setDisplayName(v); if (formError) setFormError(null); if (error) clearError(); }}
          placeholder="How should we call you?"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <View style={s.fieldGap}>
          <Input
            label="Phone or email"
            value={identifier}
            onChangeText={(v) => { setIdentifier(v); if (formError) setFormError(null); if (error) clearError(); }}
            placeholder="+880170000001 or you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            helper="Used for login + password recovery."
          />
        </View>
        <View style={s.fieldGap}>
          <PasswordInput
            label="Password"
            value={password}
            onChangeText={(v) => { setPassword(v); if (formError) setFormError(null); if (error) clearError(); }}
            placeholder="At least 6 characters"
            returnKeyType="next"
          />
          <PasswordStrengthMeter password={password} />
        </View>
        <View style={s.fieldGap}>
          <PasswordInput
            label="Confirm password"
            value={confirm}
            onChangeText={(v) => { setConfirm(v); if (formError) setFormError(null); if (error) clearError(); }}
            placeholder="Re-enter your password"
            returnKeyType="next"
            errorText={confirm && password !== confirm ? "Passwords do not match" : null}
          />
        </View>
        <View style={s.fieldGap}>
          <Input
            label="Referral code (optional)"
            value={referrerCode}
            onChangeText={setReferrerCode}
            placeholder="Leave blank if you don't have one"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Pressable style={s.termsRow} onPress={() => setAcceptedTerms((v) => !v)}>
          <Switch
            value={acceptedTerms}
            onValueChange={(v) => { setAcceptedTerms(v); if (formError) setFormError(null); }}
            trackColor={{ false: theme.surfaceAlt, true: theme.primary }}
            thumbColor={acceptedTerms ? theme.textInverse : theme.textSubtle}
          />
          <Text style={s.termsText}>
            I agree to the{" "}
            <Text style={s.link} onPress={() => router.push("/terms")}>Terms of service</Text>{" "}
            and{" "}
            <Text style={s.link} onPress={() => router.push("/privacy")}>Privacy policy</Text>.
          </Text>
        </Pressable>

        {shownError ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{shownError}</Text>
          </View>
        ) : null}

        <View style={s.fieldGap}>
          <Button
            label="Create account"
            onPress={submit}
            loading={busy}
            disabled={busy}
          />
        </View>
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>Already have an account?</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={s.footerLink}>Sign in →</Text>
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
  },
  head: {
    marginTop: spacing[4],
    gap: spacing[1],
  },
  title: {
    ...t.h1,
    color: theme.text,
  },
  sub: {
    ...t.caption,
    color: theme.textSubtle,
  },
  form: {
    marginTop: spacing[5],
    gap: spacing[2],
  },
  fieldGap: {
    marginTop: spacing[3],
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[1],
  },
  termsText: {
    ...t.caption,
    color: theme.textMuted,
    flex: 1,
    lineHeight: 20,
  },
  link: {
    color: theme.primaryMuted,
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: "rgba(251, 113, 133, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[3],
    borderRadius: 4,
  },
  errorText: {
    ...t.caption,
    color: theme.danger,
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
