import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useAppConfig } from "../../src/state/AppProviders";

/**
 * Bottom tab bar (Prompt 13).
 *
 * Tabs come from GET /v1/config/app (BrandConfig.bottomTabs) — admin edits
 * change the app without a release. The default 5-tab structure is:
 *
 *   home      → app/(tabs)/home.tsx
 *   discover  → app/(tabs)/discover.tsx
 *   live      → app/(tabs)/live.tsx
 *   messages  → app/(tabs)/messages.tsx
 *   me        → app/(tabs)/profile.tsx  (renamed for clarity)
 *
 * Legacy keys (`chat`, `games`, `wallet`) are still supported so existing
 * dev DBs and admin-customized configs don't break — they map to the
 * existing screens but render as hidden routes when not in the visible
 * tab list.
 */

const ICONS: Record<string, string> = {
  home: "🏠",
  discover: "🧭",
  live: "📡",
  messages: "💬",
  chat: "💬",       // legacy alias for `messages`
  me: "👤",
  profile: "👤",    // legacy alias for `me`
  games: "🎮",
  ranking: "🏆",
  wallet: "🪙",
};

/** Map a BrandConfig tab key onto the (tabs)/ file basename. */
function tabFile(key: string): string {
  if (key === "me" || key === "profile") return "profile";
  if (key === "chat") return "messages";   // legacy `chat` key → renamed file
  if (key === "discover") return "discover";
  return key;
}

export default function TabsLayout() {
  const { config } = useAppConfig();
  const tabs = config.bottomTabs.filter((t) => t.visible);

  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: "#0f172a" },
      headerTintColor: "#f8fafc",
      tabBarStyle: { backgroundColor: "#1e293b", borderTopColor: "#334155" },
      tabBarActiveTintColor: "#a78bfa",
      tabBarInactiveTintColor: "#64748b",
      sceneStyle: { backgroundColor: "#0f172a" },
    }}>
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.key}
          name={tabFile(tab.key)}
          options={{
            title: tab.label,
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICONS[tab.icon] ?? ICONS[tab.key] ?? "•"}</Text>,
          }}
        />
      ))}
      {/* Hidden routes — reachable via deep links + programmatic navigation
          even when not visible in the tab bar. */}
      <Tabs.Screen name="wallet" options={{ href: null }} />
      <Tabs.Screen name="games" options={{ href: null }} />
    </Tabs>
  );
}
