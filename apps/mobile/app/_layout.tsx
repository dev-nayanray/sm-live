import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { AppProviders, useAppConfig } from "../src/state/AppProviders";

function ThemedStack() {
  const { config } = useAppConfig();
  const dark = true; // dark-first social app
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0f172a" },
          headerTintColor: "#f8fafc",
          headerTitle: config.brand.appName,
          contentStyle: { backgroundColor: "#0f172a" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth/login" options={{ title: "Sign in", headerShown: false }} />
        <Stack.Screen name="auth/register" options={{ title: "Create account", headerShown: false }} />
        <Stack.Screen name="room/[id]" options={{ title: "Room" }} />
        <Stack.Screen name="game/[code]" options={{ title: "Game" }} />
        <Stack.Screen name="wallet" options={{ title: "Wallet" }} />
        <Stack.Screen name="dev" options={{ title: "Dev menu" }} />
      </Stack>
      {dark ? null : <Text />}
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

export default function RootLayout() {
  return (
    <AppProviders>
      <Boot />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  splashTitle: { color: "#a78bfa", fontSize: 34, fontWeight: "800", letterSpacing: 4 },
  splashSub: { color: "#64748b", marginTop: 8 },
});
