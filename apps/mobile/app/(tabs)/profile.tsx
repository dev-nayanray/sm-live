import { Link, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";

interface AgencyPanel {
  agency: { name: string; commissionRate: number };
  last30d: { commissionEarned: number; memberRecharges: number; members: number };
}
interface Task { key: string; label: string; done: boolean }

export default function Profile() {
  const { user, logout } = useAuth();
  const { config } = useAppConfig();
  const [agency, setAgency] = useState<AgencyPanel | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    api<{ balance: number }>("/v1/wallet/balance").then((b) => setBalance(b.balance)).catch(() => {});
    api<AgencyPanel>("/v1/agencies/panel").then(setAgency).catch(() => setAgency(null));
  }, []);

  const tasks: Task[] = [
    { key: "profile", label: "Complete your profile", done: !!user?.displayName },
    { key: "recharge", label: "First recharge", done: (balance ?? 0) > 0 },
    { key: "room", label: "Join a live room", done: false },
    { key: "gift", label: "Send your first gift", done: false },
  ];

  return (
    <ScrollView style={s.root}>
      <View style={s.head}>
        <View style={s.avatar}><Text style={s.avatarText}>{(user?.displayName ?? "?").slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{user?.displayName ?? "guest"}</Text>
          <Text style={s.sub}>user #{user?.id ?? "—"} · market {config.market}</Text>
        </View>
        <Pressable onPress={() => router.push("/wallet")} style={s.walletBtn}>
          <Text style={s.walletAmount}>{balance == null ? "…" : balance.toLocaleString()}</Text>
          <Text style={s.walletLabel}>🪙 coins</Text>
        </Pressable>
      </View>

      <Card title="🪙 Wallet">
        <LinkRow href="/wallet" label="Recharge & history →" />
      </Card>

      <Card title="🏷️ Agency">
        {agency ? (
          <>
            <Text style={s.line}>{agency.agency.name} · commission {(agency.agency.commissionRate * 100).toFixed(0)}%</Text>
            <Text style={s.lineSmall}>30d commission {agency.last30d.commissionEarned.toLocaleString()} 🪙 · {agency.last30d.members} members</Text>
          </>
        ) : (
          <Text style={s.lineSmall}>not an agency member — earnings go 100% to you</Text>
        )}
      </Card>

      <Card title="🎯 New user tasks">
        {tasks.map((t) => (
          <View key={t.key} style={s.taskRow}>
            <Text style={{ color: t.done ? "#34d399" : "#475569" }}>{t.done ? "✔" : "○"}</Text>
            <Text style={[s.taskText, t.done && { color: "#34d399" }]}>{t.label}</Text>
            <Text style={s.taskReward}>+{t.done ? 0 : 50} 🪙</Text>
          </View>
        ))}
      </Card>

      <Card title="⚙️ Settings">
        <LinkRow href="/dev" label="Dev menu (switch market)" />
        <Text style={s.lineSmall}>app {config.brand.appName} · flags {Object.keys(config.flags).length} · games {config.games.length}</Text>
      </Card>

      <Pressable style={s.logout} onPress={() => void logout()}>
        <Text style={s.logoutText}>sign out</Text>
      </Pressable>
      <Text style={s.footer}>real money: {String(config.realMoneyEnabled)} (always off in the boilerplate)</Text>
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href as never} asChild>
      <Pressable style={s.linkRow}><Text style={s.linkText}>{label}</Text></Pressable>
    </Link>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  head: { flexDirection: "row", alignItems: "center", padding: 20, gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  name: { color: "#f8fafc", fontWeight: "800", fontSize: 18 },
  sub: { color: "#64748b", fontSize: 12 },
  walletBtn: { backgroundColor: "#1e293b", borderRadius: 12, padding: 10, alignItems: "center" },
  walletAmount: { color: "#34d399", fontWeight: "800", fontSize: 16 },
  walletLabel: { color: "#64748b", fontSize: 11 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", marginBottom: 10 },
  line: { color: "#e2e8f0", marginBottom: 4 },
  lineSmall: { color: "#64748b", fontSize: 12 },
  linkRow: { paddingVertical: 10 },
  linkText: { color: "#a78bfa" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  taskText: { flex: 1, color: "#e2e8f0" },
  taskReward: { color: "#f59e0b", fontSize: 12 },
  logout: { marginHorizontal: 16, marginBottom: 12, backgroundColor: "#7f1d1d", borderRadius: 12, padding: 14, alignItems: "center" },
  logoutText: { color: "#fecaca", fontWeight: "700" },
  footer: { color: "#475569", textAlign: "center", fontSize: 11, marginBottom: 30 },
});
