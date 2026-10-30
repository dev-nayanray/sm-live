import { Link, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../../src/api/client";
import { useAppConfig } from "../../src/state/AppProviders";
import { Avatar, Badge, Card, EmptyState, ErrorState, Loading, SectionHeader, theme, t, spacing } from "../../src/components";
import { filterRooms, type DiscoverRoom } from "../../src/hooks/discoverPure";

/**
 * SM Live — Discover screen (Prompt 13).
 *
 * Aggregates three real backend data sources into a single explore view:
 *   1. /v1/rooms — open live / voice / party rooms for discovery.
 *   2. /v1/gifts/ranking?period=weekly — top gifters (acts as
 *      "popular creators" since the platform has no follow graph yet).
 *   3. /v1/games — game catalogue (acts as "trending categories" — each
 *      game is a category the user can jump into).
 *
 * A search field filters the room list locally; the backend doesn't yet
 * expose a /v1/search endpoint so we filter on already-fetched rows.
 * When the API gains a search endpoint, swap `filterRooms` for a query.
 *
 * Loading / empty / error states are surfaced explicitly — no fake rows.
 */
interface RankRow { rank: number; points: number; user: { id: number; displayName: string; avatarUrl: string; vipLevel: number } }
interface GameEntry { code: string; name: string; isPro: boolean; thumbnailUrl: string }

export default function Discover() {
  const { config, flag } = useAppConfig();
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<DiscoverRoom[]>([]);
  const [rank, setRank] = useState<RankRow[]>([]);
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, k, g] = await Promise.all([
        api<DiscoverRoom[]>("/v1/rooms"),
        api<RankRow[]>("/v1/gifts/ranking?period=weekly").catch(() => [] as RankRow[]),
        flag("games.enabled") ? api<{ data: GameEntry[] } | GameEntry[]>("/v1/games").catch(() => []) : Promise.resolve([] as GameEntry[]),
      ]);
      setRooms(r);
      setRank(k);
      // /v1/games returns { ok, data: [...] } shape — api() unwraps `data`
      // when present, so we accept either the array or the wrapped object.
      setGames(Array.isArray(g) ? g : ((g as { data?: GameEntry[] })?.data ?? []));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [flag]);

  useEffect(() => { void load(); }, [load]);

  const filtered = filterRooms(rooms, query);

  if (loading) return <Loading label="Loading discover…" />;

  if (error) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />
      }>
        <ErrorState
          title="Couldn't load discover feed"
          subtitle="Pull down to retry. If the problem persists, the backend may be unreachable."
          technical={error}
          ctaLabel="Retry"
          onCta={() => { setLoading(true); void load(); }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={s.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
    >
      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search rooms, hosts, or categories"
          placeholderTextColor={theme.textSubtle}
          returnKeyType="search"
        />
      </View>

      <SectionHeader title="Recommended rooms" icon="🏠" />
      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={query ? "No rooms match your search" : "No rooms are open right now"}
          subtitle={query ? "Try a different keyword, or start a room from the Live tab." : "Tap the Live tab to start one."}
        />
      ) : (
        <FlatList
          horizontal
          data={filtered.slice(0, 12)}
          keyExtractor={(r) => String(r.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[2] }}
          renderItem={({ item }) => (
            <Link href={`/room/${item.id}`} asChild>
              <Pressable style={s.roomCard}>
                <View style={s.roomHeader}>
                  <Text style={s.roomType}>{item.type === "live" ? "🔴" : item.type === "party" ? "🎉" : "🎙️"}</Text>
                  <Badge tone={item.type === "live" ? "accent" : "primary"} label={item.type} />
                </View>
                <Text style={s.roomTitle} numberOfLines={2}>{item.title}</Text>
                <View style={s.roomHost}>
                  <Avatar name={item.host.displayName} imageUrl={item.host.avatarUrl} size={32} vipLevel={item.host.vipLevel} />
                  <Text style={s.roomHostName} numberOfLines={1}>{item.host.displayName}</Text>
                </View>
                <Text style={s.roomMeta}>👥 {item.audienceCount} · 🌍 {item.country}</Text>
              </Pressable>
            </Link>
          )}
        />
      )}

      <SectionHeader title="Top creators" icon="🏆" action={
        <Pressable onPress={() => router.push("/(tabs)/live")}><Text style={s.seeAll}>see all →</Text></Pressable>
      } />
      {rank.length === 0 ? (
        <EmptyState icon="🏆" title="No ranking data yet" subtitle="Weekly gifting rankings refresh when users start sending gifts." />
      ) : (
        <Card>
          {rank.slice(0, 5).map((r) => (
            <View key={r.rank} style={s.rankRow}>
              <Text style={s.rankBadge}>{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : `#${r.rank}`}</Text>
              <Avatar name={r.user.displayName} imageUrl={r.user.avatarUrl} size={32} vipLevel={r.user.vipLevel} />
              <View style={s.rankInfo}>
                <Text style={s.rankName} numberOfLines={1}>{r.user.displayName}</Text>
                {r.user.vipLevel > 0 && <Badge tone="vip" label={`VIP${r.user.vipLevel}`} />}
              </View>
              <Text style={s.rankPoints}>{r.points.toLocaleString()} pts</Text>
            </View>
          ))}
        </Card>
      )}

      {flag("games.enabled") && (
        <>
          <SectionHeader title="Trending categories" icon="🎮" action={
            <Pressable onPress={() => router.push("/(tabs)/games")}><Text style={s.seeAll}>all games →</Text></Pressable>
          } />
          {games.length === 0 ? (
            <EmptyState icon="🎮" title="No games configured" subtitle="An admin can enable games via the Super Admin Panel." />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing[4], gap: spacing[2] }}>
              {games.slice(0, 6).map((g) => (
                <Pressable key={g.code} style={s.gameCard} onPress={() => router.push(`/game/${g.code}`)}>
                  <View style={s.gameThumb}>
                    <Text style={s.gameIcon}>{g.isPro ? "💎" : "🎲"}</Text>
                  </View>
                  <Text style={s.gameName} numberOfLines={1}>{g.name}</Text>
                  {g.isPro && <Badge tone="vip" label="PRO" />}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}

      <Text style={s.footer}>market: {config.market} · {config.games.length} games · {config.gifts.length} gifts</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  searchRow: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  searchInput: {
    height: 44,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: spacing[3],
    ...t.body,
  },
  roomCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing[3],
    width: 200,
    gap: spacing[2],
  },
  roomHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roomType: { fontSize: 16 },
  roomTitle: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
    minHeight: 42,
  },
  roomHost: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  roomHostName: {
    ...t.caption,
    color: theme.textMuted,
    flex: 1,
  },
  roomMeta: {
    ...t.micro,
    color: theme.textSubtle,
  },
  seeAll: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  rankBadge: {
    width: 32,
    fontSize: 16,
    textAlign: "center",
  },
  rankInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rankName: {
    ...t.body,
    color: theme.text,
    flex: 1,
  },
  rankPoints: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "700",
  },
  gameCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing[3],
    width: 140,
    gap: spacing[2],
  },
  gameThumb: {
    height: 80,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  gameIcon: { fontSize: 32 },
  gameName: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  footer: {
    ...t.micro,
    color: theme.textSubtle,
    textAlign: "center",
    marginVertical: spacing[5],
  },
});
