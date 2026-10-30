import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { Button, Loading, theme, t, spacing, radius } from "../../src/components";
import { vipLevelLabel, vipBadgeIcon, daysRemaining, isExpired, planKeyForLevel, type VipPlan } from "../../src/hooks/vipPure";

interface VipMembership {
  id: number; level: number; planKey: string; coinsPaid: number;
  status: string; activatedAt: string; expiresAt: string;
}
interface VipStatus {
  vipLevel: number; nobleLevel: number; membership: VipMembership | null;
}
interface WalletBalance { balance: number }

export default function VipScreen() {
  const [plans, setPlans] = useState<VipPlan[]>([]);
  const [status, setStatus] = useState<VipStatus | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, s, b] = await Promise.all([
        api<{ plans: VipPlan[] }>("/v1/vip/plans"),
        api<VipStatus>("/v1/vip/membership"),
        api<WalletBalance>("/v1/wallet/balance").catch(() => ({ balance: 0 }) as WalletBalance),
      ]);
      setPlans(p.plans);
      setStatus(s);
      setBalance(b.balance);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onPurchase = async (plan: VipPlan) => {
    if (purchasing !== null) return;
    if (balance < plan.price) {
      setError(`Insufficient coins. You need ${plan.price.toLocaleString()} but have ${balance.toLocaleString()}.`);
      return;
    }
    setPurchasing(plan.level);
    setError(null);
    setSuccess(null);
    try {
      await api("/v1/vip/purchase", { method: "POST", json: { planKey: planKeyForLevel(plan.level) } });
      setSuccess(`🎉 ${plan.name} activated! Your VIP badge is now live.`);
      await load(); // refresh status + balance
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPurchasing(null);
    }
  };

  if (loading) return <Loading label="Loading VIP…" />;

  return (
    <ScrollView style={s.root} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.primary} />}>
      {/* Current status */}
      <View style={s.statusCard}>
        <Text style={s.statusIcon}>{vipBadgeIcon(status?.vipLevel ?? 0)}</Text>
        <Text style={s.statusLevel}>{vipLevelLabel(status?.vipLevel ?? 0)}</Text>
        {status?.membership ? (
          <>
            <Text style={s.statusExpiry}>
              {isExpired(status.membership.expiresAt) ? "Expired" : `${daysRemaining(status.membership.expiresAt)} days remaining`}
            </Text>
            <Text style={s.statusExpiryDate}>
              Expires: {new Date(status.membership.expiresAt).toLocaleDateString()}
            </Text>
          </>
        ) : (
          <Text style={s.statusExpiry}>No active membership</Text>
        )}
      </View>

      {error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}
      {success && <View style={s.successBox}><Text style={s.successText}>{success}</Text></View>}

      {/* Plans */}
      <Text style={s.sectionTitle}>VIP Plans</Text>
      <Text style={s.sectionSub}>Purchase with coins from your wallet. All plans last 30 days.</Text>
      <View style={s.balancePill}>
        <Text style={s.balanceText}>🪙 {balance.toLocaleString()}</Text>
      </View>

      {plans.map((plan) => {
        const isCurrent = status?.membership?.level === plan.level;
        const canAfford = balance >= plan.price;
        return (
          <View key={plan.level} style={[s.planCard, isCurrent && s.planCardCurrent]}>
            <View style={s.planHeader}>
              <Text style={s.planIcon}>{vipBadgeIcon(plan.level)}</Text>
              <Text style={s.planName}>{plan.name}</Text>
              <Text style={s.planPrice}>🪙 {plan.price.toLocaleString()}</Text>
            </View>
            <View style={s.benefitsList}>
              {plan.benefits.map((b, i) => (
                <Text key={i} style={s.benefitItem}>✓ {b}</Text>
              ))}
            </View>
            {isCurrent ? (
              <View style={s.currentBadge}><Text style={s.currentBadgeText}>CURRENT</Text></View>
            ) : (
              <Button
                label={purchasing === plan.level ? "Processing…" : canAfford ? "Purchase" : "Insufficient coins"}
                onPress={() => onPurchase(plan)}
                disabled={purchasing !== null || !canAfford}
                loading={purchasing === plan.level}
                style={{ marginTop: spacing[2] }}
              />
            )}
          </View>
        );
      })}

      {/* History link */}
      <Pressable style={s.linkRow} onPress={() => router.push("/vip/history")}>
        <Text style={s.linkText}>Purchase History</Text>
        <Text style={s.linkArrow}>→</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  statusCard: { backgroundColor: "rgba(124,58,237,0.18)", margin: spacing[4], borderRadius: radius.xl, padding: spacing[5], alignItems: "center", gap: spacing[1] },
  statusIcon: { fontSize: 48 },
  statusLevel: { ...t.h1, color: theme.text, fontWeight: "800" },
  statusExpiry: { ...t.body, color: theme.primaryMuted, fontWeight: "600" },
  statusExpiryDate: { ...t.caption, color: theme.textSubtle },
  errorBox: { backgroundColor: "rgba(251,113,133,0.12)", borderLeftWidth: 3, borderLeftColor: theme.danger, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginHorizontal: spacing[4], borderRadius: radius.md },
  errorText: { ...t.caption, color: theme.danger },
  successBox: { backgroundColor: "rgba(52,211,153,0.12)", borderLeftWidth: 3, borderLeftColor: theme.success, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginHorizontal: spacing[4], borderRadius: radius.md },
  successText: { ...t.caption, color: theme.success, fontWeight: "700" },
  sectionTitle: { ...t.h2, color: theme.text, paddingHorizontal: spacing[4], marginTop: spacing[4] },
  sectionSub: { ...t.caption, color: theme.textSubtle, paddingHorizontal: spacing[4] },
  balancePill: { alignSelf: "flex-end", marginHorizontal: spacing[4], backgroundColor: theme.surface, paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.pill, marginTop: spacing[1] },
  balanceText: { ...t.caption, color: theme.success, fontWeight: "700" },
  planCard: { marginHorizontal: spacing[4], marginBottom: spacing[3], backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[4] },
  planCardCurrent: { borderColor: theme.vip, borderWidth: 2 },
  planHeader: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  planIcon: { fontSize: 24 },
  planName: { ...t.h2, color: theme.text, flex: 1 },
  planPrice: { ...t.body, color: theme.success, fontWeight: "700" },
  benefitsList: { marginTop: spacing[2], gap: spacing[1] },
  benefitItem: { ...t.caption, color: theme.textMuted },
  currentBadge: { backgroundColor: theme.vip, paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.pill, alignSelf: "flex-start", marginTop: spacing[2] },
  currentBadgeText: { ...t.micro, color: theme.bg, fontWeight: "800" },
  linkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3], marginHorizontal: spacing[4], marginTop: spacing[2], marginBottom: spacing[6] },
  linkText: { ...t.body, color: theme.text, fontWeight: "600" },
  linkArrow: { ...t.body, color: theme.textSubtle },
});
