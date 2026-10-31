import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Badge, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";
import { categoryIcon, categoryLabel, formatNotificationTime } from "../../src/hooks/notificationPure";

interface NotifItem {
  id: number; category: string; title: string; body: string;
  link: string; read: boolean; meta: unknown; createdAt: string;
}

export default function NotificationCenter() {
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ items: NotifItem[] }>(`/v1/notifications?page=1&pageSize=50${unreadOnly ? "&unreadOnly=true" : ""}`);
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [unreadOnly]);

  useEffect(() => { void load(); }, [load]);

  const markAllRead = async () => {
    try {
      await api("/v1/notifications/read-all", { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ }
  };

  const markRead = async (id: number) => {
    try {
      await api(`/v1/notifications/${id}/read`, { method: "POST" });
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch { /* ignore */ }
  };

  const onTap = (n: NotifItem) => {
    if (!n.read) void markRead(n.id);
    if (n.link) {
      try { router.push(n.link as never); } catch { /* invalid link — ignore */ }
    }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <Text style={s.title}>Notifications</Text>
        <View style={s.headerActions}>
          <Pressable style={[s.filterChip, !unreadOnly && s.filterChipActive]} onPress={() => setUnreadOnly(false)}>
            <Text style={[s.filterText, !unreadOnly && s.filterTextActive]}>All</Text>
          </Pressable>
          <Pressable style={[s.filterChip, unreadOnly && s.filterChipActive]} onPress={() => setUnreadOnly(true)}>
            <Text style={[s.filterText, unreadOnly && s.filterTextActive]}>Unread</Text>
          </Pressable>
        </View>
      </View>
      {items.some((n) => !n.read) && (
        <Pressable style={s.markAllBtn} onPress={markAllRead}>
          <Text style={s.markAllText}>Mark all as read</Text>
        </Pressable>
      )}
      {loading ? <Loading label="Loading notifications…" /> : error ? (
        <ErrorState title="Couldn't load notifications" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="🔔" title={unreadOnly ? "No unread notifications" : "No notifications yet"} subtitle="You're all caught up!" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.primary} />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.card, !item.read && s.cardUnread, pressed && { opacity: 0.7 }]}
              onPress={() => onTap(item)}
            >
              <View style={s.cardHeader}>
                <Text style={s.cardIcon}>{categoryIcon(item.category)}</Text>
                <View style={s.cardInfo}>
                  <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                  <Badge tone="muted" label={categoryLabel(item.category)} />
                </View>
                <Text style={s.cardTime}>{formatNotificationTime(item.createdAt)}</Text>
              </View>
              {item.body ? <Text style={s.cardBody} numberOfLines={2}>{item.body}</Text> : null}
              {!item.read && <View style={s.unreadDot} />}
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
  headerActions: { flexDirection: "row", gap: spacing[1] },
  filterChip: { paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radius.pill, backgroundColor: theme.surfaceAlt },
  filterChipActive: { backgroundColor: theme.primary },
  filterText: { ...t.micro, color: theme.textMuted, fontWeight: "600" },
  filterTextActive: { color: theme.textInverse },
  markAllBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  markAllText: { ...t.caption, color: theme.primaryMuted, fontWeight: "600" },
  card: { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3], gap: spacing[1] },
  cardUnread: { borderColor: theme.primary, borderWidth: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  cardIcon: { fontSize: 24 },
  cardInfo: { flex: 1, gap: 2 },
  cardTitle: { ...t.body, color: theme.text, fontWeight: "700" },
  cardTime: { ...t.micro, color: theme.textSubtle },
  cardBody: { ...t.caption, color: theme.textMuted, lineHeight: 18 },
  unreadDot: { position: "absolute", top: spacing[2], right: spacing[2], width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
});
