import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useWallet } from "../src/hooks/useWallet";
import { useAuth } from "../src/state/AppProviders";
import {
  Button, Loading, theme, t, spacing, radius,
} from "../src/components";
import {
  formatCoinAmount, formatTransactionKind, isCreditKind,
} from "../src/hooks/giftPure";

const PRESETS = [100, 500, 1000, 5000];

export default function WalletScreen() {
  const { loggedIn } = useAuth();
  const wallet = useWallet(loggedIn);
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>Sign in to see your wallet.</Text>
      </View>
    );
  }

  if (wallet.loading && wallet.balance === 0) {
    return <Loading label="Loading wallet…" />;
  }

  const recharge = async (value: number) => {
    if (busy) return;
    setBusy(true);
    try { await wallet.recharge(value); } finally { setBusy(false); }
  };

  return (
    <ScrollView
      style={s.root}
      refreshControl={<RefreshControl refreshing={wallet.loading} onRefresh={() => void wallet.refresh()} tintColor={theme.primary} />}
    >
      {/* Balance hero card */}
      <View style={s.balanceCard}>
        <Text style={s.balanceLabel}>COIN BALANCE</Text>
        <Text style={s.balanceAmount}>{formatCoinAmount(wallet.balance)}</Text>
        <Text style={s.balanceCurrency}>🪙 virtual coins</Text>
        {wallet.error ? <Text style={s.errorText}>{wallet.error}</Text> : null}
      </View>

      {/* Quick recharge */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>⚡ Quick recharge</Text>
        <Text style={s.sectionSub}>Fake payment adapter — instant success (dev only).</Text>
        <View style={s.presetsRow}>
          {PRESETS.map((p) => (
            <Pressable key={p} style={s.presetBtn} disabled={busy} onPress={() => void recharge(p)}>
              <Text style={s.presetText}>+{formatCoinAmount(p)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.customRow}>
          <TextInput
            style={s.customInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            placeholder="Custom amount"
            placeholderTextColor={theme.textSubtle}
          />
          <Button
            label="Recharge"
            onPress={() => void recharge(Number(amount) || 0)}
            loading={busy}
            disabled={busy}
            style={s.rechargeBtn}
          />
        </View>
      </View>

      {/* Gift store + history shortcuts */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>🎁 Gifts</Text>
        <Pressable style={s.linkRow} onPress={() => router.push("/gifts/store")}>
          <Text style={s.linkText}>Browse Gift Store</Text>
          <Text style={s.linkArrow}>→</Text>
        </Pressable>
        <Pressable style={s.linkRow} onPress={() => router.push("/gifts/sent")}>
          <Text style={s.linkText}>Gifts Sent</Text>
          <Text style={s.linkArrow}>→</Text>
        </Pressable>
        <Pressable style={s.linkRow} onPress={() => router.push("/gifts/received")}>
          <Text style={s.linkText}>Gifts Received</Text>
          <Text style={s.linkArrow}>→</Text>
        </Pressable>
      </View>

      {/* Transaction history */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>📜 Transaction History</Text>
        {wallet.history.length === 0 ? (
          <Text style={s.muted}>No transactions yet.</Text>
        ) : (
          wallet.history.map((h) => (
            <View key={h.id} style={s.txRow}>
              <View style={s.txBody}>
                <Text style={s.txKind}>{formatTransactionKind(h.kind)}</Text>
                <Text style={s.txDate}>{new Date(h.createdAt).toLocaleString()}</Text>
              </View>
              <Text style={[isCreditKind(h.amount) ? s.txCredit : s.txDebit]}>
                {h.amount >= 0 ? "+" : ""}{formatCoinAmount(h.amount)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={s.footer}>All amounts in virtual coins. Real-money payments are disabled in the boilerplate.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg },
  muted: { ...t.body, color: theme.textSubtle },

  // Balance card
  balanceCard: {
    backgroundColor: "rgba(124, 58, 237, 0.18)",
    margin: spacing[4],
    borderRadius: radius.xl,
    padding: spacing[6],
    alignItems: "center",
    gap: spacing[1],
  },
  balanceLabel: { ...t.micro, color: theme.primaryMuted, letterSpacing: 2 },
  balanceAmount: { ...t.display, color: theme.text, fontWeight: "800" },
  balanceCurrency: { ...t.caption, color: theme.textSubtle },
  errorText: { ...t.caption, color: theme.danger, marginTop: spacing[1] },

  // Section
  section: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
    gap: spacing[2],
  },
  sectionTitle: { ...t.h2, color: theme.text },
  sectionSub: { ...t.caption, color: theme.textSubtle },

  // Recharge
  presetsRow: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
  presetBtn: {
    flex: 1, backgroundColor: theme.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.border, paddingVertical: spacing[3],
    alignItems: "center",
  },
  presetText: { ...t.body, color: theme.success, fontWeight: "700" },
  customRow: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
  customInput: {
    flex: 1, height: 48, backgroundColor: theme.surface, color: theme.text,
    borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
    paddingHorizontal: spacing[3], ...t.body,
  },
  rechargeBtn: { height: 48, paddingHorizontal: spacing[4] },

  // Links
  linkRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: theme.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.border, padding: spacing[3],
  },
  linkText: { ...t.body, color: theme.text, fontWeight: "600" },
  linkArrow: { ...t.body, color: theme.textSubtle },

  // Transaction
  txRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: theme.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: theme.border, padding: spacing[3],
    marginBottom: spacing[1],
  },
  txBody: { flex: 1, gap: 1 },
  txKind: { ...t.body, color: theme.text, fontWeight: "600" },
  txDate: { ...t.micro, color: theme.textSubtle },
  txCredit: { ...t.body, color: theme.success, fontWeight: "800" },
  txDebit: { ...t.body, color: theme.danger, fontWeight: "800" },

  footer: { ...t.micro, color: theme.textSubtle, textAlign: "center", marginVertical: spacing[4] },
});
