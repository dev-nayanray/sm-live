import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Avatar, Badge, Button, Loading, SectionHeader, theme, t, spacing, radius,
} from "../../src/components";
import { formatCount, getFollowState, followButtonLabel } from "../../src/hooks/socialPure";

interface UserProfile {
  id: number; displayName: string; avatarUrl: string;
  vipLevel: number; nobleLevel: number; country: string;
  marketCode: string; createdAt: string;
  followerCount: number; followingCount: number;
  isFollowing: boolean; isBlocked: boolean;
}

export default function ProfileTab() {
  const { user, loggedIn, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setError(null);
    try {
      const data = await api<UserProfile>(`/v1/users/${user.id}`);
      setProfile(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <Loading />
        <Button label="Sign in" onPress={() => router.replace("/auth/welcome")} style={{ marginTop: spacing[3] }} />
      </View>
    );
  }

  if (loading) return <Loading label="Loading profile…" />;
  if (error || !profile) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error ?? "Profile not found"}</Text>
        <Button variant="ghost" label="Retry" onPress={() => { setLoading(true); void load(); }} style={{ marginTop: spacing[2] }} />
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
    } catch {
      // Silently fail — the UI state is optimistic and will be corrected on next load.
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      {/* Profile header */}
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

        {/* Stats row */}
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

        {/* Action buttons */}
        <View style={s.actionsRow}>
          {followState === "self" ? (
            <Button label="Edit Profile" icon="✏️" onPress={() => router.push("/profile/edit")} style={{ flex: 1 }} />
          ) : (
            <Button
              label={followButtonLabel(followState)}
              variant={followState === "following" ? "ghost" : "primary"}
              onPress={onFollowToggle}
              loading={followBusy}
              disabled={followBusy || followState === "blocked"}
              style={{ flex: 1 }}
            />
          )}
          {followState !== "self" && (
            <Button variant="ghost" label="Message" onPress={() => router.push("/chat/new")} style={{ flex: 1 }} />
          )}
        </View>
      </View>

      {/* Quick actions */}
      <SectionHeader title="More" icon="☰" />
      <View style={s.menuWrap}>
        {followState === "self" && (
          <>
            <MenuRow icon="⚙️" label="Settings" onPress={() => router.push("/settings")} />
            <MenuRow icon="🪙" label="Wallet" onPress={() => router.push("/wallet")} />
            <MenuRow icon="🎁" label="Gift Store" onPress={() => router.push("/gifts/store")} />
            <MenuRow icon="🚫" label="Blocked Users" onPress={() => router.push("/profile/blocked")} />
          </>
        )}
        {followState !== "self" && (
          <MenuRow icon="🚩" label="Report User" onPress={() => router.push(`/profile/${profile.id}/report`)} />
        )}
        <MenuRow icon="🧭" label="Help & Support" onPress={() => router.push("/support")} />
        {followState === "self" && (
          <MenuRow icon="↩" label="Sign Out" onPress={() => void logout()} danger />
        )}
      </View>
    </ScrollView>
  );
}

function MenuRow({ icon, label, onPress, danger }: { icon: string; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [s.menuRow, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Text style={s.menuIcon}>{icon}</Text>
      <Text style={[s.menuLabel, danger && { color: theme.danger }]}>{label}</Text>
      <Text style={s.menuArrow}>→</Text>
    </Pressable>
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
  menuWrap: { marginHorizontal: spacing[4], gap: spacing[1] },
  menuRow: {
    flexDirection: "row", alignItems: "center", gap: spacing[3],
    backgroundColor: theme.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.border, padding: spacing[3],
  },
  menuIcon: { fontSize: 18 },
  menuLabel: { ...t.body, color: theme.text, flex: 1, fontWeight: "600" },
  menuArrow: { ...t.body, color: theme.textSubtle },
});
