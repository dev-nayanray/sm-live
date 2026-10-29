import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAppConfig } from "../../src/state/AppProviders";

/** Games list straight from GET /v1/config/app — no hard-coded entries. */
export default function Games() {
  const { config, flag } = useAppConfig();
  const [error, setError] = useState<string | null>(null);

  const enabled = flag("games.enabled");
  const games = config.games;

  const open = useCallback((code: string) => {
    router.push(`/game/${code}`);
  }, []);

  if (!enabled) {
    return (
      <View style={s.center}>
        <Text style={s.big}>🎮</Text>
        <Text style={s.title}>Games are switched off</Text>
        <Text style={s.sub}>An admin can enable them in Settings → feature flags (games.enabled).</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.title}>couldn’t load games</Text>
        <Text style={s.sub}>{error}</Text>
      </View>
    );
  }

  void api; // health probe helper kept for pull-to-refresh wiring

  return (
    <FlatList
      style={s.root}
      contentContainerStyle={{ padding: 16 }}
      data={games}
      keyExtractor={(g) => g.code}
      numColumns={2}
      columnWrapperStyle={{ gap: 10, marginBottom: 10 }}
      ListEmptyComponent={<Text style={s.sub}>no games configured for this market</Text>}
      renderItem={({ item }) => (
        <Pressable style={s.card} onPress={() => open(item.code)}>
          <View style={s.thumb}><Text style={s.thumbIcon}>{item.isPro ? "💎" : "🎲"}</Text></View>
          <Text style={s.name}>{item.name}</Text>
          <Text style={s.meta}>bet {item.minBet}–{item.maxBet} 🪙</Text>
          {item.isPro && <Text style={s.pro}>PRO</Text>}
          {item.status === "maintenance" && <Text style={s.maint}>maintenance</Text>}
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 32 },
  big: { fontSize: 48, marginBottom: 12 },
  title: { color: "#f8fafc", fontWeight: "700", fontSize: 16, marginBottom: 8 },
  sub: { color: "#64748b", textAlign: "center" },
  card: { flex: 1, backgroundColor: "#1e293b", borderRadius: 14, padding: 14 },
  thumb: { height: 80, borderRadius: 10, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  thumbIcon: { fontSize: 34 },
  name: { color: "#f8fafc", fontWeight: "700", marginBottom: 4 },
  meta: { color: "#64748b", fontSize: 12 },
  pro: { color: "#a78bfa", fontWeight: "800", fontSize: 11, marginTop: 6 },
  maint: { color: "#f59e0b", fontSize: 11, marginTop: 6 },
});
