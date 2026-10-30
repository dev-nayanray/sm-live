import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../../src/api/client";
import { Button, Badge, EmptyState, ErrorState, Loading, theme, t, spacing, radius } from "../../../src/components";
import { gameStatusLabel, gameStatusTone, gameIcon, formatCoins, canPlay } from "../../../src/hooks/gamePure";

interface GameConfig {
  market: string; marketName: string; minBet: number; maxBet: number;
  bettingSeconds: number; timeoutSeconds: number; stuckPolicy: string;
}
interface GameDetail {
  code: string; name: string; version: string; status: string; isPro: boolean;
  thumbnailUrl: string; sortOrder: number;
  provider: { name: string; enabled: boolean } | null;
  configs: GameConfig[];
}

export default function GameDetailsScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<GameDetail>(`/v1/games/${code}`);
      setDetail(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);

  const onPlay = async () => {
    if (launching || !detail || !canPlay(detail.status)) return;
    setLaunching(true);
    try {
      // The existing /game/[code] route handles the actual launch + WebView.
      router.replace(`/game/${code}`);
    } catch {
      setLaunching(false);
    }
  };

  if (loading) return <Loading label="Loading game…" />;
  if (error) return <ErrorState title="Couldn't load game" subtitle={error} ctaLabel="Back" onCta={() => router.back()} />;
  if (!detail) return <EmptyState icon="🎮" title="Game not found" />;

  const playable = canPlay(detail.status);
  const providerOk = detail.provider?.enabled ?? false;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <Text style={s.title}>Game Details</Text>
      </View>

      <View style={s.heroCard}>
        <View style={s.heroIcon}>{gameIcon(detail.isPro)}</View>
        <Text style={s.heroName}>{detail.name}</Text>
        <Text style={s.heroCode}>Code: {detail.code}</Text>
        <View style={s.badgeRow}>
          <Badge tone={gameStatusTone(detail.status)} label={gameStatusLabel(detail.status)} />
          {detail.isPro && <Badge tone="vip" label="PRO" />}
          <Badge tone="muted" label={`v${detail.version}`} />
        </View>
      </View>

      {/* Configs */}
      <View style={s.section}>
        <Text style={s.sectionTitle}> Betting & Configuration</Text>
        {detail.configs.length === 0 ? (
          <Text style={s.muted}>No market configurations.</Text>
        ) : (
          detail.configs.map((c, i) => (
            <View key={i} style={s.configRow}>
              <Text style={s.configLabel}>Market: {c.marketName}</Text>
              <Text style={s.configValue}>Bet: 🪙 {formatCoins(c.minBet)}–{formatCoins(c.maxBet)}</Text>
              <Text style={s.configValue}>Betting window: {c.bettingSeconds}s</Text>
              <Text style={s.configValue}>Timeout: {c.timeoutSeconds}s</Text>
              <Text style={s.configValue}>Stuck policy: {c.stuckPolicy}</Text>
            </View>
          ))
        )}
      </View>

      {/* Provider */}
      {detail.provider && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Provider</Text>
          <View style={s.configRow}>
            <Text style={s.configLabel}>{detail.provider.name}</Text>
            <Badge tone={detail.provider.enabled ? "success" : "danger"} label={detail.provider.enabled ? "Enabled" : "Disabled"} />
          </View>
        </View>
      )}

      {/* Play button */}
      <View style={s.playWrap}>
        <Button
          label={launching ? "Launching…" : "Play Now"}
          icon="▶"
          onPress={onPlay}
          loading={launching}
          disabled={!playable || !providerOk || launching}
          style={s.playBtn}
        />
        {!playable && <Text style={s.playHint}>This game is currently {gameStatusLabel(detail.status).toLowerCase()}.</Text>}
        {playable && !providerOk && <Text style={s.playHint}>The game provider is disabled.</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 18, color: theme.text },
  title: { ...t.h2, color: theme.text },
  heroCard: { alignItems: "center", gap: spacing[2], padding: spacing[5] },
  heroIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(124,58,237,0.18)", alignItems: "center", justifyContent: "center", fontSize: 40 },
  heroName: { ...t.h1, color: theme.text, textAlign: "center" },
  heroCode: { ...t.caption, color: theme.textSubtle },
  badgeRow: { flexDirection: "row", gap: spacing[1], flexWrap: "wrap", justifyContent: "center" },
  section: { marginHorizontal: spacing[4], marginBottom: spacing[3], backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  sectionTitle: { ...t.h2, color: theme.text, marginBottom: spacing[2] },
  muted: { ...t.body, color: theme.textSubtle },
  configRow: { gap: spacing[1], paddingVertical: spacing[1] },
  configLabel: { ...t.body, color: theme.text, fontWeight: "600" },
  configValue: { ...t.caption, color: theme.textMuted },
  playWrap: { paddingHorizontal: spacing[4], marginTop: spacing[3] },
  playBtn: { height: 52 },
  playHint: { ...t.caption, color: theme.warning, textAlign: "center", marginTop: spacing[2] },
});
