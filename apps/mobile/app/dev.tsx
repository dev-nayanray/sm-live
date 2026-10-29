import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAppConfig } from "../src/state/AppProviders";

/** Dev menu: switch market to test per-market config (games, bet limits, flags). */
export default function DevMenu() {
  const { market, setMarket, config } = useAppConfig();
  const router = useRouter();
  const markets = ["default", "bd"];

  return (
    <ScrollView style={s.root}>
      <Text style={s.title}>Dev menu</Text>
      <Text style={s.sub}>current market: <Text style={{ color: "#a78bfa", fontWeight: "700" }}>{market}</Text></Text>
      <View style={s.row}>
        {markets.map((m) => (
          <Pressable key={m} style={[s.btn, market === m && s.btnActive]} onPress={() => setMarket(m)}>
            <Text style={[s.btnText, market === m && s.btnTextActive]}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>resolved config</Text>
        <Text style={s.line}>brand: {config.brand.appName} ({config.brand.primaryColor})</Text>
        <Text style={s.line}>games: {config.games.length} · gifts: {config.gifts.length}</Text>
        <Text style={s.line}>tabs: {config.bottomTabs.map((t) => t.key).join(", ")}</Text>
        <Text style={s.line}>real money: {String(config.realMoneyEnabled)}</Text>
        {Object.entries(config.flags).map(([k, v]) => (
          <Text key={k} style={s.line}>flag {k}: {String(v)}</Text>
        ))}
      </View>
      <Pressable style={s.back} onPress={() => router.back()}><Text style={s.backText}>← back</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 20 },
  title: { color: "#f8fafc", fontSize: 22, fontWeight: "800", marginBottom: 4 },
  sub: { color: "#64748b", marginBottom: 16 },
  row: { flexDirection: "row", gap: 8, marginBottom: 16 },
  btn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: "#1e293b" },
  btnActive: { backgroundColor: "#7c3aed" },
  btnText: { color: "#94a3b8", fontWeight: "700", textTransform: "uppercase" },
  btnTextActive: { color: "#fff" },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginBottom: 16 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", marginBottom: 10 },
  line: { color: "#94a3b8", fontSize: 13, marginBottom: 4 },
  back: { alignItems: "center", padding: 14 },
  backText: { color: "#a78bfa" },
});
