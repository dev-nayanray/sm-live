import { router } from "expo-router";
import { Text, View } from "react-native";
import { useEffect } from "react";
import { useAuth } from "../src/state/AppProviders";
import { theme, t, spacing } from "../src/theme";

/**
 * Startup gate (Prompt 14).
 *
 * Single source of truth for "where should the app be right now based on
 * the auth state". The four states map to four routes:
 *
 *   loading          → stay here (splash handled by app/_layout.tsx)
 *   authenticated    → /(tabs)/home
 *   unauthenticated  → /auth/welcome
 *   expired          → /auth/welcome (with a "session expired" message
 *                      surfaced by AppProviders.error — the Welcome
 *                      screen shows it via the useAuth() hook)
 *   error            → /auth/welcome (the form screens show the inline
 *                      error themselves)
 *
 * Keeping the routing logic here (rather than scattering router.replace
 * calls through every auth screen) means:
 *   - No double navigation when login succeeds.
 *   - The Android back button can't escape back into the auth stack
 *     after a successful login (router.replace + the auth gate's
 *     reactive effect handle this).
 *   - Session-expiry events from the API client (refresh-failed
 *     listener in AppProviders) automatically bounce the user back
 *     to /auth/welcome.
 */
export default function Startup() {
  const { ready, status } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (status === "authenticated") {
      router.replace("/(tabs)/home");
    } else {
      // unauthenticated | expired | error → welcome screen
      router.replace("/auth/welcome");
    }
  }, [ready, status]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...t.caption, color: theme.textSubtle }}>{ready ? "redirecting…" : "starting…"}</Text>
    </View>
  );
}

void spacing;
