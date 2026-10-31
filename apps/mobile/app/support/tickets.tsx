import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Badge, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { ticketStatusLabel, ticketStatusTone, formatNotificationTime } from "../../src/hooks/notificationPure";

interface TicketItem {
  id: number; subject: string; category: string; priority: string;
  status: string; createdAt: string; updatedAt: string;
  lastMessage: string | null; lastMessageAt: string | null;
}

export default function MyTicketsScreen() {
  const [items, setItems] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageNum: number) => {
    setError(null);
    try {
      const data = await api<{ items: TicketItem[]; total: number; pageSize: number }>(
        `/v1/support/tickets?page=${pageNum}&pageSize=30`,
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
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <Text style={s.title}>My Tickets</Text>
        <Pressable style={s.newBtn} onPress={() => router.push("/support/new")}>
          <Text style={s.newBtnText}>+ New</Text>
        </Pressable>
      </View>
      {loading ? <Loading label="Loading tickets…" /> : error ? (
        <ErrorState title="Couldn't load tickets" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(1); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="📋" title="No tickets yet" subtitle="Need help? Tap '+ New' to create a support ticket." ctaLabel="Create Ticket" onCta={() => router.push("/support/new")} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          onEndReached={() => hasMore && !loading && void load(page + 1)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <Pressable style={s.card} onPress={() => router.push(`/support/${item.id}`)}>
              <View style={s.cardHeader}>
                <Text style={s.cardSubject} numberOfLines={1}>{item.subject}</Text>
                <Badge tone={ticketStatusTone(item.status)} label={ticketStatusLabel(item.status)} />
              </View>
              {item.lastMessage && (
                <Text style={s.cardPreview} numberOfLines={2}>{item.lastMessage}</Text>
              )}
              <View style={s.cardFooter}>
                <Badge tone="muted" label={item.category} />
                <Text style={s.cardTime}>{formatNotificationTime(item.updatedAt)}</Text>
              </View>
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
  title: { ...t.h2, color: theme.text, flex: 1 },
  newBtn: { backgroundColor: theme.primary, paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.pill },
  newBtnText: { ...t.caption, color: theme.textInverse, fontWeight: "700" },
  card: { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3], gap: spacing[1] },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  cardSubject: { ...t.body, color: theme.text, fontWeight: "700", flex: 1 },
  cardPreview: { ...t.caption, color: theme.textMuted, lineHeight: 18 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing[1] },
  cardTime: { ...t.micro, color: theme.textSubtle },
});
