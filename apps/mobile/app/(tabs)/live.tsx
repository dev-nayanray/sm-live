import { Link, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import {
  Badge, Button, EmptyState, ErrorState, Loading, RoomCard, TopHeader,
  theme, t, spacing, type RoomCardData,
} from "../../src/components";

/**
 * SM Live — Live tab (Prompt 17).
 *
 * Rewritten from the original to use the design-system RoomCard +
 * TopHeader + the new Start Live flow (/live/start).
 *
 * Features:
 *   - TopHeader (brand + search + notifications + wallet + avatar).
 *   - Filter chips: All / Live / Voice / Party. Selecting re-fetches
 *     /v1/rooms?type=… (server-side filter).
 *   - "Go live" CTA button → routes to /live/start (the Start Live
 *     configuration screen).
 *   - Pull-to-refresh.
 *   - Per-room RoomCard with LIVE badge + audience count.
 *
 * Real data only — /v1/rooms returns only open rooms (closedAt === null)
 * so the list never shows stale rooms. The audienceCount comes from the
 * RoomParticipant table (real DB count, not fabricated).
 */

type Room = RoomCardData;

type FilterType = "all" | "live" | "voice" | "party";

const FILTERS: Array<{ key: FilterType; label: string; icon: string }> = [
  { key: "all", label: "All", icon: "🌍" },
  { key: "live", label: "Live", icon: "🔴" },
  { key: "voice", label: "Voice", icon: "🎙️" },
  { key: "party", label: "Party", icon: "🎉" },
];

export default function LiveTab() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = filter === "all" ? "" : `?type=${filter}`;
      const data = await api<Room[]>(`/v1/rooms${q}`);
      setRooms(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  return (
    <View style={s.root}>
      <TopHeader />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => { setFilter(f.key); setLoading(true); }}
            style={[s.chip, filter === f.key && s.chipActive]}
          >
            <Text style={[s.chipText, filter === f.key && s.chipTextActive]}>
              {f.icon} {f.label}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button
          label="Go live"
          icon="🔴"
          onPress={() => router.push("/live/start")}
          style={s.goLiveBtn}
        />
      </ScrollView>

      {loading && rooms.length === 0 ? (
        <Loading label="Loading live rooms…" />
      ) : error ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        >
          <ErrorState
            title="Couldn't load live rooms"
            subtitle="Pull down to retry. If the problem persists, the backend may be unreachable."
            technical={error}
            ctaLabel="Retry"
            onCta={() => { setLoading(true); void load(); }}
          />
        </ScrollView>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon="📡"
          title="No live rooms right now"
          subtitle="Be the first — tap 'Go live' to start your own broadcast."
          ctaLabel="Go live"
          onCta={() => router.push("/live/start")}
        />
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: spacing[4], gap: spacing[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          renderItem={({ item }) => (
            <Link href={`/room/${item.id}`} asChild>
              <Pressable>
                <RoomCard room={item} variant="list" />
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  filterRow: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  chipText: {
    ...t.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  chipTextActive: {
    color: theme.textInverse,
  },
  goLiveBtn: {
    height: 36,
    paddingHorizontal: spacing[3],
  },
});

// Keep Badge imported for type-check (used by RoomCard internally).
void Badge;
