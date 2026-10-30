import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Avatar, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { formatCoinAmount, formatGiftHistoryTime } from "../../src/hooks/giftPure";

interface ReceivedGift {
  id: number;
  giftId: number;
  giftName: string;
  giftIconUrl: string;
  giftPrice: number;
  senderId: number;
  senderName: string;
  senderAvatarUrl: string;
  quantity: number;
  totalPrice: number;
  createdAt: string;
}

export default function ReceivedGiftsScreen() {
  const [items, setItems] = useState<ReceivedGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageNum: number) => {
    setError(null);
    try {
      const data = await api<{ items: ReceivedGift[]; total: number; pageSize: number }>(
        `/v1/gifts/received?page=${pageNum}&pageSize=30`,
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
        <Text style={s.title}>Gifts Received</Text>
      </View>
      {loading ? (
        <Loading label="Loading…" />
      ) : error ? (
        <ErrorState title="Couldn't load" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(1); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="🎁" title="No gifts received yet" subtitle="Go live or join a voice room to receive gifts!" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          onEndReached={() => hasMore && !loading && void load(page + 1)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <View style={s.card} key={item.id}>
              <Avatar name={item.senderName} imageUrl={item.senderAvatarUrl} size={40} />
              <View style={s.cardBody}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.giftName} × {item.quantity}</Text>
                <Text style={s.cardSub} numberOfLines={1}>From: {item.senderName}</Text>
                <Text style={s.cardTime}>{formatGiftHistoryTime(item.createdAt)}</Text>
              </View>
              <Text style={s.cardCost}>+{formatCoinAmount(item.totalPrice)} 🪙</Text>
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
  cardBody: { flex: 1, gap: 1 },
  cardTitle: { ...t.body, color: theme.text, fontWeight: "700" },
  cardSub: { ...t.caption, color: theme.textMuted },
  cardTime: { ...t.micro, color: theme.textSubtle },
  cardCost: { ...t.body, color: theme.success, fontWeight: "700" },
});
