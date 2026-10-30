import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Badge, Button, EmptyState, ErrorState, Loading, TopHeader,
  theme, t, spacing, radius,
} from "../../src/components";
import { gameIcon, formatCoins } from "../../src/hooks/gamePure";

interface GameItem {
  code: string; name: string; isPro: boolean;
  thumbnailUrl: string; version: string;
  minBet: number | null; maxBet: number | null;
}

export default function GamesTab() {
  const { loggedIn } = useAuth();
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<GameItem[]>("/v1/games");
      setGames(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (loggedIn) void load(); }, [loggedIn, load]);

  const filtered = search.trim()
    ? games.filter((g) =>
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        g.code.toLowerCase().includes(search.toLowerCase()))
    : games;

  if (!loggedIn) {
    return (
      <View style={s.root}>
        <TopHeader />
        <EmptyState icon="🎮" title="Sign in to play" subtitle="Games are available to signed-in users." ctaLabel="Sign in" onCta={() => router.replace("/auth/welcome")} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <TopHeader />
      <View style={s.header}>
        <Text style={s.title}>Games</Text>
        <Button variant="ghost" label="History" onPress={() => router.push("/game/history")} style={{ height: 36, paddingHorizontal: spacing[3] }} />
      </View>
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search games…"
          placeholderTextColor={theme.textSubtle}
        />
      </View>
      {loading ? <Loading label="Loading games…" /> : error ? (
        <ErrorState title="Couldn't load games" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(); }} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🎮" title={search ? "No games match" : "No games available"} subtitle={search ? "Try a different search." : "Check back later or contact an admin."} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(g) => g.code}
          numColumns={2}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          columnWrapperStyle={{ gap: spacing[2], marginBottom: spacing[2] }}
          renderItem={({ item: g }) => (
            <Pressable
              style={s.card}
              onPress={() => router.push(`/game/${g.code}/details`)}
            >
              <View style={s.thumb}>
                <Text style={s.thumbIcon}>{gameIcon(g.isPro)}</Text>
              </View>
              <Text style={s.gameName} numberOfLines={1}>{g.name}</Text>
              {g.minBet != null && g.maxBet != null && (
                <Text style={s.gameBet}>🪙 {formatCoins(g.minBet)}–{formatCoins(g.maxBet)}</Text>
              )}
              <View style={s.badgeRow}>
                {g.isPro && <Badge tone="vip" label="PRO" />}
                <Badge tone="muted" label={g.version} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

import { TextInput } from "react-native";

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  title: { ...t.h1, color: theme.text },
  searchRow: { padding: spacing[3] },
  searchInput: { height: 44, backgroundColor: theme.surface, color: theme.text, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: spacing[3], ...t.body },
  card: { flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3], alignItems: "center", gap: spacing[1] },
  thumb: { width: 70, height: 70, borderRadius: 35, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  thumbIcon: { fontSize: 32 },
  gameName: { ...t.body, color: theme.text, fontWeight: "700", textAlign: "center" },
  gameBet: { ...t.micro, color: theme.success, fontWeight: "700" },
  badgeRow: { flexDirection: "row", gap: spacing[1] },
});
