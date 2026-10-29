import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useAppConfig } from "../../src/state/AppProviders";

/**
 * Bottom tabs come from GET /v1/config/app (BrandConfig.bottomTabs) —
 * admin edits change the app without a release.
 */
const ICONS: Record<string, string> = {
  home: "🏠", games: "🎮", live: "📡", chat: "💬", me: "👤", ranking: "🏆", wallet: "🪙",
};

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
          name={tab.key === "me" ? "profile" : tab.key}
          options={{
            title: tab.label,
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICONS[tab.icon] ?? "•"}</Text>,
          }}
        />
      ))}
      {/* wallet reachable even when not in the tab bar */}
      <Tabs.Screen name="wallet" options={{ href: null }} />
    </Tabs>
  );
}
