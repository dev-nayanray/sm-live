/**
 * SM Live — Gift Store screen (Prompt 20).
 *
 * Displays available gifts from the real backend (GET /v1/gifts).
 * Category filter chips + search. Tapping a gift opens a send-gift
 * confirmation modal. The screen is reachable from the Profile tab
 * + from the GiftSheet in rooms.
 */
import { router } from "expo-router";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Button, EmptyState, ErrorState, Loading,
  theme, t, spacing, radius,
} from "../../src/components";
import {
  GIFT_CATEGORIES, formatCoinAmount, giftCategoryLabel,
  totalGiftCost, canAffordGift, giftAnimationIcon, type GiftView,
} from "../../src/hooks/giftPure";

interface GiftStoreState {
  gifts: GiftView[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

export default function GiftStoreScreen() {
  const { user } = useAuth();
  const [state, setState] = useState<GiftStoreState>({
    gifts: [], loading: true, refreshing: false, error: null,
  });
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [balance, setBalance] = useState(0);
  const [selectedGift, setSelectedGift] = useState<GiftView | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      if (category) params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      const data = await api<{ items: GiftView[] }>(`/v1/gifts?${params}`);
      setState({ gifts: data.items, loading: false, refreshing: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, refreshing: false, error: (e as Error).message }));
    }
  }, [category, search]);

  const loadBalance = useCallback(async () => {
    try {
      const data = await api<{ balance: number }>("/v1/wallet/balance");
      setBalance(data.balance);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadBalance(); }, [loadBalance]);

  const onSelectGift = (g: GiftView) => {
    setSelectedGift(g);
    setQuantity(1);
    setSendResult(null);
  };

  const onSendGift = async (recipientId: number) => {
    if (!selectedGift || sending) return;
    setSending(true);
    setSendResult(null);
    try {
      await api("/v1/gifts/send", {
        method: "POST",
        json: { giftId: selectedGift.id, recipientId, quantity },
      });
      setSendResult({ ok: true, message: `Sent ${quantity}× ${selectedGift.name}!` });
      void loadBalance();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setSendResult({ ok: false, message: msg });
    } finally {
      setSending(false);
    }
  };

  const filtered = state.gifts;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Text style={s.title}>Gift Store</Text>
        <View style={s.balancePill}>
          <Text style={s.balanceText}>🪙 {formatCoinAmount(balance)}</Text>
        </View>
      </View>

      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search gifts…"
          placeholderTextColor={theme.textSubtle}
          returnKeyType="search"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
        <Pressable
          style={[s.chip, !category && s.chipActive]}
          onPress={() => setCategory(null)}
        >
          <Text style={[s.chipText, !category && s.chipTextActive]}>All</Text>
        </Pressable>
        {GIFT_CATEGORIES.map((c) => (
          <Pressable
            key={c}
            style={[s.chip, category === c && s.chipActive]}
            onPress={() => setCategory(c)}
          >
            <Text style={[s.chipText, category === c && s.chipTextActive]}>{giftCategoryLabel(c)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {state.loading ? (
        <Loading label="Loading gifts…" />
      ) : state.error ? (
        <ErrorState title="Couldn't load gifts" subtitle={state.error} ctaLabel="Retry" onCta={() => void load()} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🎁" title="No gifts found" subtitle="Try a different category or search." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(g) => String(g.id)}
          numColumns={3}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
          refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={load} tintColor={theme.primary} />}
          renderItem={({ item: g }) => (
            <Pressable style={s.giftCard} onPress={() => onSelectGift(g)}>
              <View style={s.giftThumb}>
                <Text style={s.giftEmoji}>{giftAnimationIcon(g.animation)}</Text>
              </View>
              <Text style={s.giftName} numberOfLines={1}>{g.name}</Text>
              <Text style={s.giftPrice}>🪙 {formatCoinAmount(g.price)}</Text>
            </Pressable>
          )}
        />
      )}

      {/* Gift send modal */}
      <Modal visible={!!selectedGift} transparent animationType="slide" onRequestClose={() => setSelectedGift(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            {selectedGift && (
              <>
                <View style={s.modalGiftHeader}>
                  <Text style={s.modalGiftEmoji}>{giftAnimationIcon(selectedGift.animation)}</Text>
                  <Text style={s.modalGiftName}>{selectedGift.name}</Text>
                  <Text style={s.modalGiftPrice}>🪙 {formatCoinAmount(selectedGift.price)} each</Text>
                </View>

                <View style={s.qtyRow}>
                  <Pressable style={s.qtyBtn} onPress={() => setQuantity((q) => Math.max(1, q - 1))}>
                    <Text style={s.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={s.qtyValue}>{quantity}</Text>
                  <Pressable style={s.qtyBtn} onPress={() => setQuantity((q) => Math.min(100, q + 1))}>
                    <Text style={s.qtyBtnText}>+</Text>
                  </Pressable>
                </View>

                <Text style={s.totalCost}>
                  Total: 🪙 {formatCoinAmount(totalGiftCost(selectedGift.price, quantity))}
                </Text>
                <Text style={canAffordGift(balance, selectedGift.price, quantity) ? s.affordYes : s.affordNo}>
                  {canAffordGift(balance, selectedGift.price, quantity)
                    ? "✓ You can afford this"
                    : "✗ Insufficient coins — recharge needed"}
                </Text>

                {sendResult && (
                  <View style={[s.resultBox, sendResult.ok ? s.resultOk : s.resultErr]}>
                    <Text style={sendResult.ok ? s.resultOkText : s.resultErrText}>{sendResult.message}</Text>
                  </View>
                )}

                <View style={s.modalActions}>
                  <Button variant="ghost" label="Close" onPress={() => { setSelectedGift(null); setSendResult(null); }} style={{ flex: 1 }} />
                  {user && (
                    <Button
                      label="Send to me"
                      icon="🎁"
                      onPress={() => onSendGift(user.id)}
                      loading={sending}
                      disabled={sending || !canAffordGift(balance, selectedGift.price, quantity)}
                      style={{ flex: 1 }}
                    />
                  )}
                </View>
                <Text style={s.sendHint}>
                  Tap "Send to me" to test. From a live/voice room, gifts are sent to the host or selected participant.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing[2],
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 18, color: theme.text },
  title: { ...t.h2, color: theme.text, flex: 1 },
  balancePill: { backgroundColor: "rgba(124, 58, 237, 0.18)", paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radius.pill },
  balanceText: { ...t.caption, color: theme.success, fontWeight: "700" },
  searchRow: { padding: spacing[3] },
  searchInput: { height: 44, backgroundColor: theme.surface, color: theme.text, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: spacing[3], ...t.body },
  chipsRow: { paddingHorizontal: spacing[3], gap: spacing[2], paddingBottom: spacing[2] },
  chip: { paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.pill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  chipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipText: { ...t.caption, color: theme.textMuted, fontWeight: "600" },
  chipTextActive: { color: theme.textInverse },
  giftCard: { flex: 1, margin: spacing[1], backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[2], alignItems: "center", gap: spacing[1] },
  giftThumb: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  giftEmoji: { fontSize: 28 },
  giftName: { ...t.caption, color: theme.text, fontWeight: "600" },
  giftPrice: { ...t.micro, color: theme.success, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: spacing[4] },
  modalCard: { backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing[5], width: "100%", maxWidth: 360, gap: spacing[3] },
  modalGiftHeader: { alignItems: "center", gap: spacing[1] },
  modalGiftEmoji: { fontSize: 48 },
  modalGiftName: { ...t.h2, color: theme.text },
  modalGiftPrice: { ...t.caption, color: theme.textSubtle },
  qtyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[3] },
  qtyBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  qtyBtnText: { fontSize: 22, color: theme.text },
  qtyValue: { ...t.h1, color: theme.text, minWidth: 40, textAlign: "center" },
  totalCost: { ...t.body, color: theme.text, textAlign: "center", fontWeight: "700" },
  affordYes: { ...t.caption, color: theme.success, textAlign: "center", fontWeight: "600" },
  affordNo: { ...t.caption, color: theme.danger, textAlign: "center", fontWeight: "600" },
  resultBox: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.md },
  resultOk: { backgroundColor: "rgba(52, 211, 153, 0.12)" },
  resultErr: { backgroundColor: "rgba(251, 113, 133, 0.12)" },
  resultOkText: { ...t.caption, color: theme.success },
  resultErrText: { ...t.caption, color: theme.danger },
  modalActions: { flexDirection: "row", gap: spacing[2] },
  sendHint: { ...t.micro, color: theme.textSubtle, textAlign: "center" },
});
