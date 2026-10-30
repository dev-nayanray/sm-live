import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";
import { Button, theme, t, spacing, radius } from "../../src/components";

/**
 * SM Live — Welcome screen (Prompt 14).
 *
 * Branded entry point shown to unauthenticated users. Surfaces the app
 * name + a short tagline + two CTAs: "Sign in" (primary) and "Create
 * account" (ghost). The screen is intentionally minimal — the auth
 * forms live on their own routes so deep links can jump straight to
 * them.
 *
 * Also surfaces the AppProviders.error message when present (e.g.
 * "Your session has expired" after a refresh-token failure) so the
 * user understands why they were bounced back to login.
 */
export default function Welcome() {
  const { config } = useAppConfig();
  const { error, status, clearError } = useAuth();
  const appName = config.brand.appName || "SM Live";
  const showSessionExpired = status === "expired" && !!error;

  return (
    <ScrollView contentContainerStyle={s.root} bounces={false}>
      <View style={s.brandWrap}>
        <View style={s.logoCircle}>
          <Text style={s.logoText}>SM</Text>
        </View>
        <Text style={s.title}>{appName}</Text>
        <Text style={s.tagline}>Live • Voice • Games • Gifts</Text>
      </View>

      {showSessionExpired && (
        <View style={s.noticeBox}>
          <Text style={s.noticeIcon}>ℹ️</Text>
          <Text style={s.noticeText}>{error}</Text>
          <Pressable onPress={clearError} style={s.dismissBtn}>
            <Text style={s.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      <View style={s.ctas}>
        <Button label="Sign in" onPress={() => router.push("/auth/login")} />
        <Button variant="ghost" label="Create account" onPress={() => router.push("/auth/register")} style={s.ghostBtn} />
      </View>

      <View style={s.legalWrap}>
        <Text style={s.legal}>
          By continuing you agree to our{" "}
          <Text style={s.link} onPress={() => router.push("/terms")}>Terms</Text>{" "}
          and{" "}
          <Text style={s.link} onPress={() => router.push("/privacy")}>Privacy Policy</Text>.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: spacing[5],
    justifyContent: "space-between",
    paddingVertical: spacing[8],
  },
  brandWrap: {
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[8],
  },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    ...t.display,
    color: theme.textInverse,
    fontWeight: "800",
  },
  title: {
    ...t.display,
    color: theme.text,
    letterSpacing: 2,
  },
  tagline: {
    ...t.caption,
    color: theme.textSubtle,
    letterSpacing: 1,
  },
  noticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.warning,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 4,
    marginHorizontal: spacing[2],
    marginVertical: spacing[3],
  },
  noticeIcon: { fontSize: 18 },
  noticeText: {
    ...t.caption,
    color: theme.warning,
    flex: 1,
  },
  dismissBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  dismissText: {
    ...t.micro,
    color: theme.textMuted,
    fontWeight: "600",
  },
  ctas: {
    gap: spacing[2],
  },
  ghostBtn: {
    backgroundColor: "transparent",
  },
  legalWrap: {
    alignItems: "center",
    paddingHorizontal: spacing[3],
  },
  legal: {
    ...t.caption,
    color: theme.textSubtle,
    textAlign: "center",
  },
  link: {
    color: theme.primaryMuted,
    fontWeight: "600",
  },
});

void radius;
void Pressable;
