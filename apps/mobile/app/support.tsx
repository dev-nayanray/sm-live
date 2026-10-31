import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/state/AppProviders";
import { theme, t, spacing, radius } from "../src/components";

export default function SupportScreen() {
  const { loggedIn } = useAuth();

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <View style={s.head}>
        <Text style={s.title}>Help & Support</Text>
        <Text style={s.sub}>We're here to help. Browse tickets, start a new one, or chat with us.</Text>
      </View>

      <View style={s.menuWrap}>
        <Pressable style={s.menuRow} onPress={() => loggedIn ? router.push("/support/tickets") : router.replace("/auth/welcome")}>
          <Text style={s.menuIcon}>📋</Text>
          <Text style={s.menuLabel}>My Support Tickets</Text>
          <Text style={s.menuArrow}>→</Text>
        </Pressable>

        <Pressable style={s.menuRow} onPress={() => loggedIn ? router.push("/support/new") : router.replace("/auth/welcome")}>
          <Text style={s.menuIcon}>✏️</Text>
          <Text style={s.menuLabel}>Create a Ticket</Text>
          <Text style={s.menuArrow}>→</Text>
        </Pressable>

        <Pressable style={s.menuRow} onPress={() => router.push("/chat/lobby")}>
          <Text style={s.menuIcon}>💬</Text>
          <Text style={s.menuLabel}>Live Chat (Lobby)</Text>
          <Text style={s.menuArrow}>→</Text>
        </Pressable>

        <Pressable style={s.menuRow} onPress={() => router.push("/terms")}>
          <Text style={s.menuIcon}>📄</Text>
          <Text style={s.menuLabel}>Terms of Service</Text>
          <Text style={s.menuArrow}>→</Text>
        </Pressable>

        <Pressable style={s.menuRow} onPress={() => router.push("/privacy")}>
          <Text style={s.menuIcon}>🔒</Text>
          <Text style={s.menuLabel}>Privacy Policy</Text>
          <Text style={s.menuArrow}>→</Text>
        </Pressable>
      </View>

      <View style={s.infoCard}>
        <Text style={s.infoTitle}>Need Quick Help?</Text>
        <Text style={s.infoBody}>
          For wallet issues, include the transaction reference from your wallet history.
          For room issues, include the room ID. For account issues, include your user ID.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  head: { paddingHorizontal: spacing[4], paddingTop: spacing[5], paddingBottom: spacing[2], gap: spacing[1] },
  title: { ...t.h1, color: theme.text },
  sub: { ...t.caption, color: theme.textSubtle, lineHeight: 20 },
  menuWrap: { marginHorizontal: spacing[4], gap: spacing[1] },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  menuIcon: { fontSize: 18 },
  menuLabel: { ...t.body, color: theme.text, fontWeight: "600", flex: 1 },
  menuArrow: { ...t.body, color: theme.textSubtle },
  infoCard: { marginHorizontal: spacing[4], marginTop: spacing[4], backgroundColor: "rgba(124,58,237,0.12)", borderRadius: radius.lg, padding: spacing[4], gap: spacing[1] },
  infoTitle: { ...t.h2, color: theme.primaryMuted },
  infoBody: { ...t.caption, color: theme.textMuted, lineHeight: 20 },
});
