import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { Component, useEffect, useState } from "react";
import { AppProviders, useAppConfig } from "../src/state/AppProviders";
import { OnlineBanner } from "../src/components/OnlineBanner";
import { theme, t, spacing } from "../src/theme";

/**
 * Root layout (Prompt 13).
 *
 * - Renders the splash screen for ~400ms while auth + config load.
 * - Wraps the Stack with an error boundary so a render-time crash in any
 *   screen surfaces a recoverable "Something went wrong" view rather than
 *   a blank white screen.
 * - Renders an OnlineBanner above the Stack so the user gets a clear
 *   "You're offline" warning when the API is unreachable.
 * - Declares every Stack route (including the new Prompt 13 routes:
 *   settings, support, terms, privacy, chat/lobby, support/tickets,
 *   support/new) so expo-router knows the headers + transition style.
 *
 * Dark-first: the app ships dark by default; the splash, headers, and
 * status bar all assume the dark palette. A later prompt can wire a
 * theme toggle that flips these tokens.
 */
function ThemedStack() {
  const { config } = useAppConfig();
  return (
    <>
      <StatusBar style="light" />
      <OnlineBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.text,
          headerTitle: config.brand.appName,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth/welcome" options={{ title: "Welcome", headerShown: false }} />
        <Stack.Screen name="auth/login" options={{ title: "Sign in", headerShown: false }} />
        <Stack.Screen name="auth/register" options={{ title: "Create account", headerShown: false }} />
        <Stack.Screen name="auth/otp" options={{ title: "OTP sign-in", headerShown: false }} />
        <Stack.Screen name="auth/forgot-password" options={{ title: "Forgot password", headerShown: false }} />
        <Stack.Screen name="auth/reset-password" options={{ title: "Reset password", headerShown: false }} />
        <Stack.Screen name="room/[id]" options={{ title: "Room" }} />
        <Stack.Screen name="game/[code]" options={{ title: "Game" }} />
        <Stack.Screen name="wallet" options={{ title: "Wallet" }} />
        <Stack.Screen name="dev" options={{ title: "Dev menu" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="support" options={{ title: "Help & support" }} />
        <Stack.Screen name="support/tickets" options={{ title: "My tickets" }} />
        <Stack.Screen name="support/new" options={{ title: "Open a ticket" }} />
        <Stack.Screen name="terms" options={{ title: "Terms of service" }} />
        <Stack.Screen name="privacy" options={{ title: "Privacy policy" }} />
        <Stack.Screen name="chat/lobby" options={{ title: "Lobby" }} />
        <Stack.Screen name="search" options={{ title: "Search" }} />
      </Stack>
    </>
  );
}

function Boot() {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 400);
    return () => clearTimeout(t);
  }, []);
  if (!booted) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashTitle}>SM LIVE</Text>
        <Text style={styles.splashSub}>loading…</Text>
      </View>
    );
  }
  return <ThemedStack />;
}

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Pino logger is not available on mobile — the error is captured in
    // state so the user can copy the message if needed. A later prompt
    // can wire this to a remote error reporter (e.g. Sentry).
    void info;
    void error;
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errWrap}>
          <Text style={styles.errIcon}>⚠️</Text>
          <Text style={styles.errTitle}>Something went wrong</Text>
          <Text style={styles.errBody}>{this.state.error?.message ?? "Unknown error"}</Text>
          <Text style={styles.errHint}>Restart the app. If the problem persists, contact support.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <Boot />
      </AppProviders>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  splashTitle: { ...t.display, color: theme.primaryMuted, letterSpacing: 4 },
  splashSub: { ...t.caption, color: theme.textSubtle, marginTop: spacing[2] },
  errWrap: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: spacing[5], gap: spacing[2] },
  errIcon: { fontSize: 44 },
  errTitle: { ...t.h1, color: theme.danger },
  errBody: { ...t.body, color: theme.textMuted, textAlign: "center" },
  errHint: { ...t.caption, color: theme.textSubtle, textAlign: "center" },
});
