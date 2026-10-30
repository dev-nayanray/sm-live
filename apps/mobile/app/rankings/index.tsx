import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Avatar, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { formatRank, formatPoints, RANKING_PERIODS, vipBadgeIcon } from "../../src/hooks/vipPure";

interface RankUser {
  id: number; displayName: string; avatarUrl: string;
  vipLevel: number; nobleLevel: number; country: string;
}
interface RankEntry { rank: number; userId: number; points: number; user: RankUser }
interface MyRank { period: string; points: number; rank: number | null; note?: string }

export default function RankingsScreen() {
  const [period, setPeriod] = useState<string>("weekly");
  const [items, setItems] = useState<RankEntry[]>([]);
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, me] = await Promise.all([
        api<{ items: RankEntry[] }>(`/v1/rankings?period=${period}&page=1&pageSize=50`),
        api<MyRank>(`/v1/rankings/me?period=${period}`),
      ]);
      setItems(r.items);
      setMyRank(me);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Text style={s.title}>Rankings</Text>
      </View>

      <View style={s.periodRow}>
        {RANKING_PERIODS.map((p) => (
          <Pressable key={p.key} style={[s.periodChip, period === p.key && s.periodChipActive]} onPress={() => { setPeriod(p.key); setLoading(true); }}>
            <Text style={[s.periodText, period === p.key && s.periodTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* My rank card */}
      {myRank && (
        <View style={s.myRankCard}>
          <Text style={s.myRankLabel}>Your Rank ({myRank.period})</Text>
          <Text style={s.myRankValue}>
            {myRank.rank ? formatRank(myRank.rank) : "Unranked"}
          </Text>
          <Text style={s.myRankPoints}>{formatPoints(myRank.points)} points</Text>
          {myRank.note && <Text style={s.myRankNote}>{myRank.note}</Text>}
        </View>
      )}

      {loading ? <Loading label="Loading rankings…" /> : error ? (
        <ErrorState title="Couldn't load rankings" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="🏆" title="No rankings yet" subtitle="Rankings update when users start sending gifts." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.userId)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[1] }}
          renderItem={({ item }) => (
            <Pressable style={s.rankRow} onPress={() => router.push(`/profile/${item.userId}`)}>
              <Text style={s.rankNum}>{formatRank(item.rank)}</Text>
              <Avatar name={item.user.displayName} imageUrl={item.user.avatarUrl} size={36} vipLevel={item.user.vipLevel} />
              <View style={s.rankInfo}>
                <Text style={s.rankName} numberOfLines={1}>
                  {vipBadgeIcon(item.user.vipLevel)} {item.user.displayName}
                </Text>
                <Text style={s.rankCountry}>{item.user.country}</Text>
              </View>
              <Text style={s.rankPoints}>{formatPoints(item.points)} pts</Text>
            </Pressable>
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
  periodRow: { flexDirection: "row", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  periodChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.pill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  periodChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  periodText: { ...t.caption, color: theme.textMuted, fontWeight: "600" },
  periodTextActive: { color: theme.textInverse },
  myRankCard: { marginHorizontal: spacing[3], marginBottom: spacing[2], backgroundColor: "rgba(124,58,237,0.18)", borderRadius: radius.lg, padding: spacing[3], gap: spacing[1] },
  myRankLabel: { ...t.micro, color: theme.primaryMuted, textTransform: "uppercase", letterSpacing: 1 },
  myRankValue: { ...t.h1, color: theme.text },
  myRankPoints: { ...t.body, color: theme.success, fontWeight: "700" },
  myRankNote: { ...t.caption, color: theme.textSubtle },
  rankRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[2] },
  rankNum: { ...t.body, color: theme.textMuted, fontWeight: "700", minWidth: 56 },
  rankInfo: { flex: 1, gap: 1 },
  rankName: { ...t.body, color: theme.text, fontWeight: "600" },
  rankCountry: { ...t.micro, color: theme.textSubtle },
  rankPoints: { ...t.body, color: theme.success, fontWeight: "700" },
});
