import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { Button, Input, theme, t, spacing } from "../../src/components";
import { validateIdentifier, validateOtpCode } from "../../src/hooks/authPure";
import { useAuth } from "../../src/state/AppProviders";

/**
 * SM Live — OTP verification screen (Prompt 14).
 *
 * Two-step flow:
 *   1. Enter identifier → tap "Send code" → backend POST /v1/auth/otp/request.
 *   2. Enter 6-digit code → tap "Verify" → backend POST /v1/auth/otp/verify.
 *
 * Features:
 *   - 30s resend cooldown (matches the backend's 5/min rate limit so the
 *     user can't accidentally trip it by spamming resend).
 *   - Dev-only "code hint" badge so dev builds can paste the code without
 *     a real SMS gateway. The backend returns `devCode` only when
 *     NODE_ENV !== "production" (it's stripped in prod).
 *   - OTP attempt limit is enforced server-side: a wrong code consumes
 *     the OTP, forcing a fresh request. The UI surfaces this clearly.
 *   - Successful verify flips the auth state to "authenticated" via the
 *     `otpLogin` action in AppProviders.
 */
const RESEND_COOLDOWN_S = 30;

export default function OtpScreen() {
  const { otpLogin, status, error, clearError } = useAuth();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const busy = status === "authenticating";
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_S);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    if (busy) return;
    clearError();
    setFormError(null);
    const id = validateIdentifier(identifier);
    if (!id.ok) return setFormError(id.message);

    try {
      const res = await api<{ devCode?: string; expiresIn: number }>("/v1/auth/otp/request", {
        method: "POST",
        json: { identifier: identifier.trim() },
      });
      if (res.devCode) setDevHint(res.devCode);
      setStep("verify");
      startCooldown();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const verify = async () => {
    if (busy) return;
    clearError();
    setFormError(null);
    const c = validateOtpCode(code);
    if (!c.ok) return setFormError(c.message);

    try {
      await otpLogin(identifier.trim(), code.trim());
      // Success — AppProviders flips to "authenticated"; index.tsx routes.
    } catch (e) {
      // Backend consumes the OTP on wrong code → user must request a new one.
      if (e instanceof ApiError) {
        setFormError(`${e.message} Tap "Resend code" to get a new one.`);
        setStep("request");
      } else {
        setFormError((e as Error).message);
      }
    }
  };

  const shownError = formError ?? error;

  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>OTP sign-in</Text>
        <Text style={s.sub}>
          {step === "request"
            ? "Enter your phone or email — we'll send you a 6-digit code."
            : `Enter the 6-digit code we sent to ${identifier.trim()}.`}
        </Text>
      </View>

      <View style={s.form}>
        {step === "request" ? (
          <Input
            label="Phone or email"
            value={identifier}
            onChangeText={(v) => { setIdentifier(v); if (formError) setFormError(null); if (error) clearError(); }}
            placeholder="+880170000001 or you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={sendCode}
          />
        ) : (
          <>
            <Input
              label="6-digit code"
              value={code}
              onChangeText={(v) => { setCode(v.replace(/\D/g, "").slice(0, 6)); if (formError) setFormError(null); if (error) clearError(); }}
              placeholder="123456"
              keyboardType="number-pad"
              returnKeyType="go"
              onSubmitEditing={verify}
              maxLength={6}
            />
            {devHint && (
              <View style={s.devHintBox}>
                <Text style={s.devHintLabel}>Dev hint</Text>
                <Text style={s.devHintCode}>{devHint}</Text>
                <Text style={s.devHintNote}>Production builds hide this — code is sent via SMS/email.</Text>
              </View>
            )}
            <Pressable
              style={[s.resendRow, cooldown > 0 && { opacity: 0.5 }]}
              disabled={cooldown > 0 || busy}
              onPress={() => { setCode(""); void sendCode(); }}
            >
              <Text style={s.resendText}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Text>
            </Pressable>
          </>
        )}

        {shownError ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{shownError}</Text>
          </View>
        ) : null}

        <View style={s.fieldGap}>
          <Button
            label={step === "request" ? "Send code" : "Verify"}
            onPress={step === "request" ? sendCode : verify}
            loading={busy}
            disabled={busy}
          />
        </View>

        {step === "verify" && (
          <Pressable style={s.changeIdRow} onPress={() => { setStep("request"); setCode(""); setDevHint(null); setFormError(null); clearError(); }}>
            <Text style={s.changeIdText}>← Change identifier</Text>
          </Pressable>
        )}
      </View>

      <View style={s.footer}>
        <Pressable onPress={() => router.push("/auth/login")}>
          <Text style={s.footerLink}>← Back to sign in</Text>
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
  },
  form: {
    marginTop: spacing[5],
    gap: spacing[2],
  },
  fieldGap: {
    marginTop: spacing[3],
  },
  devHintBox: {
    backgroundColor: "rgba(52, 211, 153, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
    borderRadius: 4,
  },
  devHintLabel: {
    ...t.micro,
    color: theme.success,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  devHintCode: {
    ...t.h1,
    color: theme.success,
    letterSpacing: 4,
    marginTop: spacing[1],
  },
  devHintNote: {
    ...t.micro,
    color: theme.textSubtle,
    marginTop: spacing[1],
  },
  resendRow: {
    alignSelf: "flex-end",
    marginTop: spacing[2],
    paddingVertical: spacing[1],
  },
  resendText: {
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
  changeIdRow: {
    alignSelf: "center",
    marginTop: spacing[3],
    paddingVertical: spacing[1],
  },
  changeIdText: {
    ...t.caption,
    color: theme.textMuted,
  },
  footer: {
    alignItems: "center",
    marginTop: spacing[6],
  },
  footerLink: {
    ...t.caption,
    color: theme.textSubtle,
  },
});
