import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { api } from "../../src/api/client";
import { Button, Input, theme, t, spacing } from "../../src/components";
import { validateIdentifier } from "../../src/hooks/authPure";

/**
 * SM Live — Forgot password screen (Prompt 14).
 *
 * The backend ALWAYS returns the same generic response whether or not the
 * identifier exists (account-enumeration defence). The UI mirrors that:
 * after submit, the screen shows a single "If the account exists, a
 * reset link was sent" message — never "no such account".
 *
 * In dev, the backend also returns `devToken` (the raw reset token) so
 * the user can paste it into the Reset Password screen without a real
 * email gateway. The screen surfaces this in a green "dev hint" box
 * — production builds strip the field.
 */
export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setFormError(null);
    const id = validateIdentifier(identifier);
    if (!id.ok) return setFormError(id.message);

    setBusy(true);
    try {
      const res = await api<{ devToken?: string; expiresIn: number }>(
        "/v1/auth/password/reset-request",
        { method: "POST", json: { identifier: identifier.trim() } },
      );
      if (res.devToken) setDevToken(res.devToken);
      setSent(true);
    } catch (e) {
      // Even on error, the backend returns the generic shape — but a
      // network failure still surfaces here. Show a generic message so
      // the user can retry.
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.root} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.title}>Reset your password</Text>
        <Text style={s.sub}>
          Enter the phone or email on your account. We'll send a reset code if the account exists.
        </Text>
      </View>

      {sent ? (
        <View style={s.sentWrap}>
          <View style={s.sentCard}>
            <Text style={s.sentIcon}>✉️</Text>
            <Text style={s.sentTitle}>Check your messages</Text>
            <Text style={s.sentBody}>
              If an account exists for <Text style={s.identifier}>{identifier.trim()}</Text>,
              a reset code valid for 15 minutes was sent.
            </Text>
            {devToken && (
              <View style={s.devHintBox}>
                <Text style={s.devHintLabel}>Dev hint</Text>
                <Text style={s.devHintCode} numberOfLines={1} selectable>{devToken}</Text>
                <Text style={s.devHintNote}>Production builds send the code via SMS/email.</Text>
              </View>
            )}
            <Button
              label="Enter reset code →"
              onPress={() => router.push({ pathname: "/auth/reset-password", params: { token: devToken ?? "" } })}
              style={s.continueBtn}
            />
          </View>
        </View>
      ) : (
        <View style={s.form}>
          <Input
            label="Phone or email"
            value={identifier}
            onChangeText={(v) => { setIdentifier(v); if (formError) setFormError(null); }}
            placeholder="+880170000001 or you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {formError ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{formError}</Text>
            </View>
          ) : null}
          <View style={s.fieldGap}>
            <Button label="Send reset code" onPress={submit} loading={busy} disabled={busy} />
          </View>
        </View>
      )}

      <View style={s.footer}>
        <Pressable onPress={() => router.back()}>
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
    lineHeight: 20,
  },
  form: {
    marginTop: spacing[5],
    gap: spacing[2],
  },
  fieldGap: {
    marginTop: spacing[3],
  },
  sentWrap: {
    marginTop: spacing[5],
  },
  sentCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing[5],
    alignItems: "center",
    gap: spacing[2],
  },
  sentIcon: { fontSize: 36 },
  sentTitle: {
    ...t.h2,
    color: theme.text,
  },
  sentBody: {
    ...t.body,
    color: theme.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
  identifier: {
    color: theme.text,
    fontWeight: "700",
  },
  devHintBox: {
    backgroundColor: "rgba(52, 211, 153, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.success,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
    borderRadius: 4,
    alignSelf: "stretch",
  },
  devHintLabel: {
    ...t.micro,
    color: theme.success,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  devHintCode: {
    ...t.caption,
    color: theme.success,
    fontFamily: "monospace",
    marginTop: spacing[1],
  },
  devHintNote: {
    ...t.micro,
    color: theme.textSubtle,
    marginTop: spacing[1],
  },
  continueBtn: {
    marginTop: spacing[2],
    alignSelf: "stretch",
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
});
