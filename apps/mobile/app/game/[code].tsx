import { useLocalSearchParams } from "expo-router";
import { AppState, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";

/**
 * Game screen: launches via POST /v1/games/:code/launch and opens the signed
 * provider URL in a WebView. On app foreground (reconnect), session state is
 * re-read (pending bets + balance) so play can resume.
 */
export default function GameScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { loggedIn } = useAuth();
  const [launch, setLaunch] = useState<{ url: string; sessionId: string; game: { name: string; minBet: number; maxBet: number } } | null>(null);
  const [state, setState] = useState<{ balance: number; pendingBets: { txId: string; amount: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  const refreshState = useCallback(async (sessionId: string) => {
    try {
      const s = await api<{ balance: number; pendingBets: { txId: string; amount: number }[] }>(`/v1/games/session/${sessionId}/state`);
      setState(s);
    } catch {
      /* session may belong to another login */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ url: string; sessionId: string; game: { name: string; minBet: number; maxBet: number } }>(`/v1/games/${code}/launch`, { method: "POST", json: {} });
        setLaunch(res);
        void refreshState(res.sessionId);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [code, refreshState]);

  // resume on foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/background/) && next === "active" && launch) {
        void refreshState(launch.sessionId);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [launch, refreshState]);

  if (!loggedIn) return <View style={s.center}><Text style={s.muted}>sign in to play</Text></View>;
  if (error) return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!launch) return <View style={s.center}><Text style={s.muted}>launching {code}…</Text></View>;

  return (
    <View style={s.root}>
      <View style={s.bar}>
        <Text style={s.name}>{launch.game.name}</Text>
        <Text style={s.range}>bets {launch.game.minBet}–{launch.game.maxBet} 🪙</Text>
        {state && (
          <Text style={s.state}>
            🪙 {state.balance.toLocaleString()} · pending {state.pendingBets.length}
          </Text>
        )}
      </View>
      <WebView
        source={{ uri: launch.url }}
        style={s.web}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onHttpError={() => setError("provider page failed to load — is apps/provider-mock running?")}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: "#475569" },
  err: { color: "#fb7185", padding: 24, textAlign: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  name: { color: "#f8fafc", fontWeight: "800", flex: 1 },
  range: { color: "#64748b", fontSize: 12 },
  state: { color: "#34d399", fontSize: 12, fontWeight: "700" },
  web: { flex: 1, backgroundColor: "#000" },
});
