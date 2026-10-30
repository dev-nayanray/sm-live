import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";
import { Avatar, Badge, Button, Card, Loading, SectionHeader, theme, t, spacing } from "../../src/components";

/**
 * SM Live — Profile screen (Prompt 13).
 *
 * Enhanced from the original: now fetches the full /v1/auth/me payload
 * (which returns phone [masked], email [masked], marketCode, country,
 * vipLevel, nobleLevel, createdAt, balance) and renders VIP / noble
 * badges, market + country chips, plus entry rows to Settings, Support,
 * Wallet, and Logout.
 *
 * Sensitive contact info (phone, email) is rendered masked as returned
 * by the backend — we never query or display the unmasked value. The
 * backend masks at the API boundary (apps/api/src/lib/auth.ts → publicUser).
 */
interface MeResponse {
  user: {
    id: number; displayName: string; avatarUrl?: string;
    phone: string | null; email: string | null;
    marketCode: string; country: string;
    vipLevel: number; nobleLevel: number;
    createdAt: string;
  };
  balance: number;
}
interface AgencyPanel {
  agency: { name: string; commissionRate: number };
  last30d: { commissionEarned: number; memberRecharges: number; members: number };
}

export default function Profile() {
  const { loggedIn, logout } = useAuth();
  const { config } = useAppConfig();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [agency, setAgency] = useState<AgencyPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loggedIn) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const [meRes, agencyRes] = await Promise.all([
          api<MeResponse>("/v1/auth/me"),
          api<AgencyPanel>("/v1/agencies/panel").catch(() => null),
        ]);
        if (!alive) return;
        setMe(meRes);
        setAgency(agencyRes);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <Avatar name="?" size={72} />
        <Text style={s.guestName}>Not signed in</Text>
        <Text style={s.guestHint}>Sign in to see your profile, wallet, and agency info.</Text>
        <View style={s.guestCta}>
          <Button label="Sign in" onPress={() => router.replace("/auth/login")} />
        </View>
      </View>
    );
  }

  if (loading) return <Loading label="Loading profile…" />;
  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.errorTitle}>Couldn't load profile</Text>
        <Text style={s.errorHint}>{error}</Text>
        <Button variant="ghost" label="Retry" onPress={() => { setError(null); setLoading(true); }} />
      </View>
    );
  }

  const u = me?.user;
  const bal = me?.balance ?? 0;
  const tasks = [
    { key: "profile", label: "Complete your profile", done: !!u?.displayName },
    { key: "recharge", label: "First recharge", done: bal > 0 },
    { key: "room", label: "Join a live room", done: false },
    { key: "gift", label: "Send your first gift", done: false },
  ];

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      {/* Header card with avatar + identity */}
      <View style={s.headCard}>
        <View style={s.headRow}>
          <Avatar name={u?.displayName} imageUrl={u?.avatarUrl} size={72} vipLevel={u?.vipLevel} />
          <View style={s.headInfo}>
            <Text style={s.name}>{u?.displayName ?? "guest"}</Text>
            <Text style={s.sub}>user #{u?.id ?? "—"}</Text>
            <View style={s.badgeRow}>
              {u && u.vipLevel > 0 && <Badge tone="vip" label={`VIP ${u.vipLevel}`} icon="👑" />}
              {u && u.nobleLevel > 0 && <Badge tone="noble" label={`Noble ${u.nobleLevel}`} />}
              <Badge tone="muted" label={(u?.country ?? "XX")} icon="🌍" />
            </View>
          </View>
        </View>

        <Pressable style={s.walletStrip} onPress={() => router.push("/wallet")}>
          <View>
            <Text style={s.walletLabel}>Wallet balance</Text>
            <Text style={s.walletAmount}>{bal.toLocaleString()} 🪙</Text>
          </View>
          <Text style={s.walletCta}>manage →</Text>
        </Pressable>
      </View>

      {/* Account details */}
      <SectionHeader title="Account" icon="👤" />
      <Card>
        <Row label="Display name" value={u?.displayName ?? "—"} />
        <Divider />
        <Row label="Phone" value={u?.phone ?? "—"} />
        <Divider />
        <Row label="Email" value={u?.email ?? "—"} />
        <Divider />
        <Row label="Market" value={u?.marketCode ?? config.market} />
        <Divider />
        <Row label="Joined" value={u ? new Date(u.createdAt).toLocaleDateString() : "—"} />
      </Card>

      {/* Agency */}
      <SectionHeader title="Agency" icon="🏷️" />
      <Card>
        {agency ? (
          <>
            <Text style={s.line}>{agency.agency.name} · commission {(agency.agency.commissionRate * 100).toFixed(0)}%</Text>
            <Text style={s.lineSmall}>30d commission {agency.last30d.commissionEarned.toLocaleString()} 🪙 · {agency.last30d.members} members</Text>
          </>
        ) : (
          <Text style={s.lineSmall}>not an agency member — earnings go 100% to you</Text>
        )}
      </Card>

      {/* Tasks */}
      <SectionHeader title="New user tasks" icon="🎯" />
      <Card>
        {tasks.map((task) => (
          <View key={task.key} style={s.taskRow}>
            <Text style={{ color: task.done ? theme.success : theme.textSubtle }}>{task.done ? "✔" : "○"}</Text>
            <Text style={[s.taskText, task.done && { color: theme.success }]}>{task.label}</Text>
            <Text style={s.taskReward}>+{task.done ? 0 : 50} 🪙</Text>
          </View>
        ))}
      </Card>

      {/* Navigation */}
      <SectionHeader title="More" icon="⚙️" />
      <Card>
        <NavRow label="Wallet" icon="🪙" onPress={() => router.push("/wallet")} />
        <Divider />
        <NavRow label="Settings" icon="⚙️" onPress={() => router.push("/settings")} />
        <Divider />
        <NavRow label="Help & support" icon="🧭" onPress={() => router.push("/support")} />
        <Divider />
        <NavRow label="Dev menu" icon="🛠️" onPress={() => router.push("/dev")} />
      </Card>

      <View style={s.logoutWrap}>
        <Button variant="danger" label="Sign out" icon="↩" onPress={() => void logout()} />
      </View>

      <Text style={s.footer}>app {config.brand.appName} · flags {Object.keys(config.flags).length} · games {config.games.length}</Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function NavRow({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Text style={s.rowIcon}>{icon}</Text>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>→</Text>
    </Pressable>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: spacing[5], gap: spacing[2] },
  guestName: { ...t.h1, color: theme.text },
  guestHint: { ...t.caption, color: theme.textSubtle, textAlign: "center" },
  guestCta: { marginTop: spacing[3] },

  headCard: {
    backgroundColor: theme.surface,
    marginHorizontal: spacing[4],
    marginTop: spacing[4],
    borderRadius: 16,
    padding: spacing[4],
    gap: spacing[3],
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  headInfo: { flex: 1 },
  name: { ...t.h1, color: theme.text },
  sub: { ...t.caption, color: theme.textSubtle, marginTop: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[1], marginTop: spacing[2] },

  walletStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(124, 58, 237, 0.18)",
    borderRadius: 12,
    padding: spacing[3],
  },
  walletLabel: { ...t.caption, color: theme.primaryMuted },
  walletAmount: { ...t.h1, color: theme.text, marginTop: 2 },
  walletCta: { ...t.caption, color: theme.primaryMuted, fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
    minHeight: 48,
  },
  rowIcon: { fontSize: 18 },
  rowLabel: { ...t.body, color: theme.text, flex: 1 },
  rowValue: { ...t.body, color: theme.textMuted, fontWeight: "600", flexShrink: 1 },
  chevron: { ...t.body, color: theme.textSubtle },
  divider: { height: 1, backgroundColor: theme.border },

  line: { ...t.body, color: theme.text, marginBottom: 4 },
  lineSmall: { ...t.caption, color: theme.textSubtle },

  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[2] },
  taskText: { ...t.body, color: theme.text, flex: 1 },
  taskReward: { ...t.caption, color: theme.warning, fontWeight: "700" },

  logoutWrap: { paddingHorizontal: spacing[4], marginTop: spacing[5] },
  footer: { ...t.micro, color: theme.textSubtle, textAlign: "center", marginTop: spacing[4] },

  errorTitle: { ...t.h2, color: theme.danger },
  errorHint: { ...t.caption, color: theme.textSubtle, textAlign: "center" },
});
