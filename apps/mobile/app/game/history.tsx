import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Badge, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { betStatusLabel, betStatusTone, gameIcon, formatCoins, formatGameTime } from "../../src/hooks/gamePure";

interface BetHistory {
  id: number; gameCode: string; gameName: string; gameThumbnail: string;
  amount: number; status: string; payout: number;
  providerTxId: string; roundId: string | null; roundStatus: string | null;
  createdAt: string; settledAt: string | null;
}

export default function GameHistoryScreen() {
  const [items, setItems] = useState<BetHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageNum: number) => {
    setError(null);
    try {
      const data = await api<{ items: BetHistory[]; total: number; pageSize: number }>(
        `/v1/games/history?page=${pageNum}&pageSize=30`,
      );
      setItems((prev) => pageNum === 1 ? data.items : [...prev, ...data.items]);
      setHasMore(data.items.length >= 30);
      setPage(pageNum);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(1); }, [load]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Text style={s.title}>Game History</Text>
      </View>
      {loading ? <Loading label="Loading history…" /> : error ? (
        <ErrorState title="Couldn't load" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(1); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="🎯" title="No game history yet" subtitle="Play games to see your bet history here." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          onEndReached={() => hasMore && !loading && void load(page + 1)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.gameIcon}>{gameIcon(false)}</Text>
                <View style={s.cardInfo}>
                  <Text style={s.gameName} numberOfLines={1}>{item.gameName}</Text>
                  <Text style={s.gameTime}>{formatGameTime(item.createdAt)}</Text>
                </View>
                <Badge tone={betStatusTone(item.status)} label={betStatusLabel(item.status)} />
              </View>
              <View style={s.cardRow}>
                <Text style={s.cardLabel}>Bet:</Text>
                <Text style={[s.cardValue, { color: theme.danger }]}>−{formatCoins(item.amount)} 🪙</Text>
                {item.payout > 0 && (
                  <>
                    <Text style={s.cardLabel}>Payout:</Text>
                    <Text style={[s.cardValue, { color: theme.success }]}>+{formatCoins(item.payout)} 🪙</Text>
                  </>
                )}
              </View>
              {item.roundId && (
                <Text style={s.roundInfo}>Round: {item.roundId} ({item.roundStatus})</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 18, color: theme.text },
  title: { ...t.h2, color: theme.text },
  card: { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3], gap: spacing[2] },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  gameIcon: { fontSize: 24 },
  cardInfo: { flex: 1, gap: 1 },
  gameName: { ...t.body, color: theme.text, fontWeight: "700" },
  gameTime: { ...t.micro, color: theme.textSubtle },
  cardRow: { flexDirection: "row", gap: spacing[2], alignItems: "center", flexWrap: "wrap" },
  cardLabel: { ...t.caption, color: theme.textSubtle },
  cardValue: { ...t.caption, fontWeight: "700" },
  roundInfo: { ...t.micro, color: theme.textSubtle },
});
