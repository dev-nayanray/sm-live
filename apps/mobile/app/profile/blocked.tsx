import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { Avatar, Badge, Button, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../src/components";

interface BlockedUser {
  id: number; displayName: string; avatarUrl: string;
  vipLevel: number; nobleLevel: number; country: string;
}

export default function BlockedUsersScreen() {
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unblockBusy, setUnblockBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ items: BlockedUser[]; total: number }>("/v1/social/blocked?page=1&pageSize=50");
      setItems(data.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onUnblock = async (userId: number) => {
    if (unblockBusy !== null) return;
    setUnblockBusy(userId);
    try {
      await api(`/v1/social/block/${userId}`, { method: "DELETE" });
      setItems((prev) => prev.filter((u) => u.id !== userId));
    } catch { /* optimistic */ } finally {
      setUnblockBusy(null);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <Text style={s.title}>Blocked Users</Text>
      </View>
      {loading ? <Loading label="Loading…" /> : error ? (
        <ErrorState title="Couldn't load" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="🚫" title="No blocked users" subtitle="You haven't blocked anyone." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Avatar name={item.displayName} imageUrl={item.avatarUrl} size={40} vipLevel={item.vipLevel} />
              <View style={s.rowInfo}>
                <Text style={s.rowName} numberOfLines={1}>{item.displayName}</Text>
                <View style={s.badgeRow}>
                  {item.vipLevel > 0 && <Badge tone="vip" label={`VIP${item.vipLevel}`} />}
                  {item.country && <Badge tone="muted" label={item.country} />}
                </View>
              </View>
              <Button
                variant="ghost"
                label={unblockBusy === item.id ? "…" : "Unblock"}
                onPress={() => onUnblock(item.id)}
                disabled={unblockBusy !== null}
                style={{ height: 36, paddingHorizontal: spacing[3] }}
              />
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2], backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...t.body, color: theme.text, fontWeight: "600" },
  badgeRow: { flexDirection: "row", gap: spacing[1] },
});
