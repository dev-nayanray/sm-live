import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { vipLevelLabel, vipBadgeIcon, isExpired, daysRemaining } from "../../src/hooks/vipPure";

interface VipHistoryItem {
  id: number; level: number; planKey: string; coinsPaid: number;
  status: string; activatedAt: string; expiresAt: string; createdAt: string;
}

export default function VipHistoryScreen() {
  const [items, setItems] = useState<VipHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ items: VipHistoryItem[] }>(`/v1/vip/history?page=1&pageSize=30`);
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Text style={s.title}>VIP History</Text>
      </View>
      {loading ? <Loading label="Loading…" /> : error ? (
        <ErrorState title="Couldn't load" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="⭐" title="No VIP history yet" subtitle="Purchase a VIP plan to see it here." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Text style={s.cardIcon}>{vipBadgeIcon(item.level)}</Text>
              <View style={s.cardBody}>
                <Text style={s.cardLevel}>{vipLevelLabel(item.level)}</Text>
                <Text style={s.cardDate}>Activated: {new Date(item.activatedAt).toLocaleDateString()}</Text>
                <Text style={s.cardExpiry}>
                  {item.status === "active" && !isExpired(item.expiresAt)
                    ? `${daysRemaining(item.expiresAt)} days remaining`
                    : item.status === "expired" || isExpired(item.expiresAt) ? "Expired" : item.status}
                </Text>
                <Text style={s.cardExpires}>Expires: {new Date(item.expiresAt).toLocaleDateString()}</Text>
              </View>
              <Text style={s.cardCost}>🪙 {item.coinsPaid.toLocaleString()}</Text>
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
  card: { flexDirection: "row", alignItems: "center", gap: spacing[2], backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  cardIcon: { fontSize: 28 },
  cardBody: { flex: 1, gap: 1 },
  cardLevel: { ...t.body, color: theme.text, fontWeight: "700" },
  cardDate: { ...t.caption, color: theme.textSubtle },
  cardExpiry: { ...t.caption, color: theme.success, fontWeight: "600" },
  cardExpires: { ...t.micro, color: theme.textSubtle },
  cardCost: { ...t.body, color: theme.warning, fontWeight: "700" },
});
