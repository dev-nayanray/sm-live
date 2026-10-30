import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Avatar, Badge, Button, Loading, theme, t, spacing, radius,
} from "../../src/components";
import { formatCount, getFollowState, followButtonLabel } from "../../src/hooks/socialPure";

interface UserProfile {
  id: number; displayName: string; avatarUrl: string;
  vipLevel: number; nobleLevel: number; country: string;
  marketCode: string; createdAt: string;
  followerCount: number; followingCount: number;
  isFollowing: boolean; isBlocked: boolean;
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<UserProfile>(`/v1/users/${userId}`);
      setProfile(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading label="Loading profile…" />;
  if (error || !profile) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error ?? "User not found"}</Text>
        <Button variant="ghost" label="Back" onPress={() => router.back()} style={{ marginTop: spacing[2] }} />
      </View>
    );
  }

  const followState = getFollowState({
    isFollowing: profile.isFollowing,
    isBlocked: profile.isBlocked,
    isSelf: profile.id === user?.id,
  });

  const onFollowToggle = async () => {
    if (followBusy || followState === "self" || followState === "blocked") return;
    setFollowBusy(true);
    try {
      if (followState === "following") {
        await api(`/v1/social/follow/${profile.id}`, { method: "DELETE" });
        setProfile((p) => p ? { ...p, isFollowing: false, followerCount: p.followerCount - 1 } : p);
      } else {
        await api(`/v1/social/follow/${profile.id}`, { method: "POST" });
        setProfile((p) => p ? { ...p, isFollowing: true, followerCount: p.followerCount + 1 } : p);
      }
    } catch { /* optimistic — corrected on next load */ } finally {
      setFollowBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <View style={s.headerCard}>
        <View style={s.avatarRow}>
          <Avatar name={profile.displayName} imageUrl={profile.avatarUrl} size={72} vipLevel={profile.vipLevel} />
          <View style={s.headerInfo}>
            <Text style={s.displayName}>{profile.displayName}</Text>
            <View style={s.badgeRow}>
              {profile.vipLevel > 0 && <Badge tone="vip" label={`VIP ${profile.vipLevel}`} />}
              {profile.nobleLevel > 0 && <Badge tone="noble" label={`N${profile.nobleLevel}`} />}
              <Badge tone="muted" label={profile.country} icon="🌍" />
            </View>
          </View>
        </View>

        <View style={s.statsRow}>
          <Pressable style={s.statItem} onPress={() => router.push(`/profile/${profile.id}/followers`)}>
            <Text style={s.statValue}>{formatCount(profile.followerCount)}</Text>
            <Text style={s.statLabel}>Followers</Text>
          </Pressable>
          <Pressable style={s.statItem} onPress={() => router.push(`/profile/${profile.id}/following`)}>
            <Text style={s.statValue}>{formatCount(profile.followingCount)}</Text>
            <Text style={s.statLabel}>Following</Text>
          </Pressable>
          <View style={s.statItem}>
            <Text style={s.statValue}>{new Date(profile.createdAt).getFullYear()}</Text>
            <Text style={s.statLabel}>Joined</Text>
          </View>
        </View>

        <View style={s.actionsRow}>
          <Button
            label={followButtonLabel(followState)}
            variant={followState === "following" ? "ghost" : "primary"}
            onPress={onFollowToggle}
            loading={followBusy}
            disabled={followBusy || followState === "blocked" || followState === "self"}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" label="Message" onPress={() => router.push("/chat/new")} style={{ flex: 1 }} />
        </View>
      </View>

      {followState !== "self" && (
        <View style={s.menuWrap}>
          <Pressable style={s.menuRow} onPress={() => router.push(`/profile/${profile.id}/report`)}>
            <Text style={s.menuIcon}>🚩</Text>
            <Text style={s.menuLabel}>Report User</Text>
            <Text style={s.menuArrow}>→</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg },
  errorText: { ...t.body, color: theme.danger, textAlign: "center", marginBottom: spacing[2] },
  headerCard: { margin: spacing[4], backgroundColor: theme.surface, borderRadius: radius.xl, padding: spacing[4], gap: spacing[3] },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  headerInfo: { flex: 1, gap: spacing[1] },
  displayName: { ...t.h1, color: theme.text },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1] },
  statsRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center", gap: 2 },
  statValue: { ...t.h2, color: theme.text },
  statLabel: { ...t.micro, color: theme.textSubtle },
  actionsRow: { flexDirection: "row", gap: spacing[2] },
  menuWrap: { marginHorizontal: spacing[4] },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  menuIcon: { fontSize: 18 },
  menuLabel: { ...t.body, color: theme.text, flex: 1, fontWeight: "600" },
  menuArrow: { ...t.body, color: theme.textSubtle },
});
