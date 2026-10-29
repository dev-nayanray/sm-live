import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useWallet } from "../src/hooks/useWallet";
import { useAuth } from "../src/state/AppProviders";

const PRESETS = [100, 500, 1000, 5000];
const KIND_ICONS: Record<string, string> = {
  recharge: "⬇️", bet_debit: "🎯", win_credit: "🏆", bet_refund: "↩️",
  gift_debit: "🎁", gift_credit: "🎁", agency_commission: "🏷️", admin_adjust: "🛠️", refund: "↩️",
};

export default function Wallet() {
  const { loggedIn } = useAuth();
  const wallet = useWallet(loggedIn);
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);

  if (!loggedIn) return <View style={s.center}><Text style={s.muted}>sign in to see your wallet</Text></View>;

  const recharge = async (value: number) => {
    setBusy(true);
    try {
      await wallet.recharge(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} refreshControl={<RefreshControl refreshing={wallet.loading} onRefresh={() => void wallet.refresh()} tintColor="#a78bfa" />}>
      <View style={s.balanceCard}>
        <Text style={s.balanceLabel}>coin balance</Text>
        <Text style={s.balance}>{wallet.balance.toLocaleString()} 🪙</Text>
        {wallet.error ? <Text style={s.err}>{wallet.error}</Text> : null}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>⚡ quick recharge (fake adapter — instant)</Text>
        <View style={s.presets}>
          {PRESETS.map((p) => (
            <Pressable key={p} style={s.preset} disabled={busy} onPress={() => void recharge(p)}>
              <Text style={s.presetText}>+{p.toLocaleString()}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="amount" placeholderTextColor="#475569" />
          <Pressable style={s.btn} disabled={busy} onPress={() => void recharge(Number(amount) || 0)}>
            <Text style={s.btnText}>{busy ? "…" : "recharge"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>📜 history</Text>
        {wallet.history.length === 0 ? <Text style={s.muted}>no transactions yet</Text> : wallet.history.map((h) => (
          <View key={h.id} style={s.row}>
            <Text style={s.rowIcon}>{KIND_ICONS[h.kind] ?? "•"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowKind}>{h.kind.replace(/_/g, " ")}</Text>
              <Text style={s.rowDate}>{new Date(h.createdAt).toLocaleString()}</Text>
            </View>
            <Text style={[h.amount >= 0 ? s.credit : s.debit]}>
              {h.amount >= 0 ? "+" : ""}{h.amount.toLocaleString()}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a" },
  muted: { color: "#475569" },
  err: { color: "#fb7185", textAlign: "center", marginTop: 8 },
  balanceCard: { backgroundColor: "#4c1d95", margin: 16, borderRadius: 18, padding: 24, alignItems: "center" },
  balanceLabel: { color: "#c4b5fd", textTransform: "uppercase", fontSize: 11, letterSpacing: 2 },
  balance: { color: "#fff", fontSize: 34, fontWeight: "800", marginTop: 6 },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 16 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", marginBottom: 12 },
  presets: { flexDirection: "row", gap: 8 },
  preset: { flex: 1, backgroundColor: "#0f172a", borderRadius: 10, padding: 12, alignItems: "center" },
  presetText: { color: "#34d399", fontWeight: "700" },
  input: { flex: 1, backgroundColor: "#0f172a", color: "#f8fafc", borderRadius: 10, paddingHorizontal: 12 },
  btn: { backgroundColor: "#7c3aed", borderRadius: 10, paddingHorizontal: 20, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowIcon: { fontSize: 18 },
  rowKind: { color: "#e2e8f0", textTransform: "capitalize", fontWeight: "600" },
  rowDate: { color: "#475569", fontSize: 11 },
  credit: { color: "#34d399", fontWeight: "800" },
  debit: { color: "#fb7185", fontWeight: "800" },
});
