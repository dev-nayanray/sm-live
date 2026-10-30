import { router, useLocalSearchParams } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../src/api/client";
import { useAuth } from "../../../src/state/AppProviders";
import { Avatar, Badge, Button, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../../src/components";

interface FollowUser {
  id: number; displayName: string; avatarUrl: string;
  vipLevel: number; nobleLevel: number; country: string;
  isFollowing?: boolean;
}

export default function FollowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const { user } = useAuth();
  const [items, setItems] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageNum: number) => {
    setError(null);
    try {
      const data = await api<{ items: FollowUser[]; total: number; pageSize: number }>(
        `/v1/social/followers/${userId}?page=${pageNum}&pageSize=30`,
      );
      setItems((prev) => pageNum === 1 ? data.items : [...prev, ...data.items]);
      setHasMore(data.items.length >= 30);
      setPage(pageNum);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(1); }, [load]);

  const onFollowToggle = async (targetId: number, currentlyFollowing: boolean) => {
    try {
      if (currentlyFollowing) {
        await api(`/v1/social/follow/${targetId}`, { method: "DELETE" });
      } else {
        await api(`/v1/social/follow/${targetId}`, { method: "POST" });
      }
      setItems((prev) => prev.map((u) => u.id === targetId ? { ...u, isFollowing: !currentlyFollowing } : u));
    } catch { /* optimistic */ }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <Text style={s.title}>Followers</Text>
      </View>
      {loading ? <Loading label="Loading…" /> : error ? (
        <ErrorState title="Couldn't load" subtitle={error} ctaLabel="Retry" onCta={() => { setLoading(true); void load(1); }} />
      ) : items.length === 0 ? (
        <EmptyState icon="👥" title="No followers yet" subtitle="When people follow this user, they'll appear here." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          onEndReached={() => hasMore && !loading && void load(page + 1)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Pressable style={s.rowLeft} onPress={() => router.push(`/profile/${item.id}`)}>
                <Avatar name={item.displayName} imageUrl={item.avatarUrl} size={40} vipLevel={item.vipLevel} />
                <View style={s.rowInfo}>
                  <Text style={s.rowName} numberOfLines={1}>{item.displayName}</Text>
                  <View style={s.badgeRow}>
                    {item.vipLevel > 0 && <Badge tone="vip" label={`VIP${item.vipLevel}`} />}
                    {item.country && <Badge tone="muted" label={item.country} />}
                  </View>
                </View>
              </Pressable>
              {item.id !== user?.id && (
                <Button
                  label={item.isFollowing ? "Following" : "Follow"}
                  variant={item.isFollowing ? "ghost" : "primary"}
                  onPress={() => onFollowToggle(item.id, !!item.isFollowing)}
                  style={{ height: 36, paddingHorizontal: spacing[3] }}
                />
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2], backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing[2], flex: 1 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...t.body, color: theme.text, fontWeight: "600" },
  badgeRow: { flexDirection: "row", gap: spacing[1] },
});
