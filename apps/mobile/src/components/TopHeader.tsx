/**
 * SM Live — TopHeader (Prompt 15).
 *
 * Sticky header used at the top of the Home + Discover screens. Surfaces:
 *
 *   - SM Live brand mark (logo circle + app name) — left.
 *   - Search shortcut (magnifier) — centre-right.
 *   - Notification bell with an unread badge — right.
 *   - Wallet shortcut (coin icon + balance) — right.
 *   - User avatar (tap → profile tab) — far right.
 *
 * The notification badge reads from /v1/notifications/count. The
 * endpoint currently returns 0 (no notification backend exists) — when
 * it returns a non-zero count, the badge appears.
 *
 * The avatar tap routes to the Profile tab (expo-router deep link).
 *
 * All shortcuts use Pressable + accessibilityRole="button" so VoiceOver
 * reads them correctly. The header is intentionally compact (56pt) so it
 * doesn't eat into the feed scroll area.
 */
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../state/AppProviders";
import { Avatar } from "./Avatar";
import { theme, t, spacing, radius } from "../theme";
import { formatCount } from "../hooks/feedPure";

export function TopHeader() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);

  // Poll notification count + wallet balance every 60s. Both endpoints
  // are cheap (count + single-row select) so the polling is light. We
  // could move this to a single /v1/feed/header aggregator later.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [n, b] = await Promise.all([
          api<{ unread: number; supported: boolean }>("/v1/notifications/count").catch(() => ({ unread: 0, supported: false })),
          api<{ balance: number }>("/v1/wallet/balance").catch(() => null),
        ]);
        if (!alive) return;
        setUnread(n.supported ? n.unread : 0);
        if (b) setBalance(b.balance);
      } catch { /* swallow — header is non-critical */ }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <View style={s.wrap}>
      <Pressable
        style={s.brand}
        onPress={() => router.push("/(tabs)/home")}
        accessibilityRole="button"
        accessibilityLabel="SM Live home"
      >
        <View style={s.logoCircle}>
          <Text style={s.logoText}>SM</Text>
        </View>
        <Text style={s.brandName}>SM Live</Text>
      </Pressable>

      <View style={s.actions}>
        <Pressable
          style={s.iconBtn}
          onPress={() => router.push("/search")}
          accessibilityRole="button"
          accessibilityLabel="Search"
        >
          <Text style={s.icon}>🔍</Text>
        </Pressable>

        <Pressable
          style={s.iconBtn}
          onPress={() => router.push("/(tabs)/messages")}
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        >
          <Text style={s.icon}>🔔</Text>
          {unread > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{formatCount(unread)}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={s.walletBtn}
          onPress={() => router.push("/wallet")}
          accessibilityRole="button"
          accessibilityLabel="Wallet"
        >
          <Text style={s.walletIcon}>🪙</Text>
          {balance != null && (
            <Text style={s.walletAmount}>{formatCount(balance)}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
        >
          <Avatar name={user?.displayName} imageUrl={user?.avatarUrl} size={32} vipLevel={user?.vipLevel} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    height: 56,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    ...t.caption,
    color: theme.textInverse,
    fontWeight: "800",
  },
  brandName: {
    ...t.body,
    color: theme.text,
    fontWeight: "800",
    letterSpacing: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  iconBtn: {
    position: "relative",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 16 },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: theme.textInverse,
    fontSize: 10,
    fontWeight: "800",
  },
  walletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  walletIcon: { fontSize: 14 },
  walletAmount: {
    ...t.caption,
    color: theme.success,
    fontWeight: "700",
  },
});
