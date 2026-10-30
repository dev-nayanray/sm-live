import { Link, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/state/AppProviders";
import { Button, Card, EmptyState, SectionHeader, theme, t, spacing } from "../src/components";

/**
 * SM Live — Support screen (Prompt 13).
 *
 * Surfaces the customer-support surface that DOES exist on the platform
 * (Prompt 11 added SupportTicket + TicketMessage on the backend) while
 * honestly documenting that the mobile UI for browsing / filing tickets
 * is not yet implemented.
 *
 * The screen lists three real actions:
 *   1. Browse my tickets      → /support/tickets (placeholder list — to be built in a later prompt)
 *   2. Open a new ticket      → /support/new    (placeholder form — to be built in a later prompt)
 *   3. Live chat with support  → /chat/lobby     (real — jumps to the existing lobby)
 *
 * The user can always reach the existing lobby for live help. The other
 * two rows are honest placeholders that explain what's coming.
 */
export default function Support() {
  const { loggedIn } = useAuth();

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <EmptyState
          icon="🔐"
          title="Sign in for support"
          subtitle="You need to be signed in to file a ticket or chat with the support team."
          ctaLabel="Sign in"
          onCta={() => router.replace("/auth/login")}
        />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <Text style={s.title}>Help & support</Text>

      <SectionHeader title="Get help fast" icon="⚡" />
      <Card>
        <Link href="/chat/lobby" asChild>
          <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}>
            <View style={s.rowBody}>
              <Text style={s.rowIcon}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>Live chat with support</Text>
                <Text style={s.rowHint}>Open the global lobby — a teammate usually replies within minutes.</Text>
              </View>
              <Text style={s.chevron}>→</Text>
            </View>
          </Pressable>
        </Link>
      </Card>

      <SectionHeader title="My tickets" icon="🎫" />
      <Card>
        <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => router.push("/support/tickets")}>
          <View style={s.rowBody}>
            <Text style={s.rowIcon}>📋</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Browse my tickets</Text>
              <Text style={s.rowHint}>View tickets you've opened and their status.</Text>
            </View>
            <Text style={s.chevron}>→</Text>
          </View>
        </Pressable>
        <View style={s.divider} />
        <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => router.push("/support/new")}>
          <View style={s.rowBody}>
            <Text style={s.rowIcon}>✏️</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Open a new ticket</Text>
              <Text style={s.rowHint}>Report a problem or request help — describe the issue and submit.</Text>
            </View>
            <Text style={s.chevron}>→</Text>
          </View>
        </Pressable>
        <Text style={s.helper}>Ticket browsing + filing UI is being designed. The backend (Prompt 11) already accepts tickets.</Text>
      </Card>

      <SectionHeader title="Other" icon="📚" />
      <Card>
        <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => router.push("/terms")}>
          <View style={s.rowBody}>
            <Text style={s.rowIcon}>📄</Text>
            <Text style={s.rowLabel}>Terms of service</Text>
            <Text style={s.chevron}>→</Text>
          </View>
        </Pressable>
        <View style={s.divider} />
        <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => router.push("/privacy")}>
          <View style={s.rowBody}>
            <Text style={s.rowIcon}>🔒</Text>
            <Text style={s.rowLabel}>Privacy policy</Text>
            <Text style={s.chevron}>→</Text>
          </View>
        </Pressable>
      </Card>

      <View style={s.backWrap}>
        <Button variant="ghost" label="← back" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: "center" },
  title: { ...t.h1, color: theme.text, paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  row: {
    paddingVertical: spacing[3],
    minHeight: 56,
  },
  rowBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  rowIcon: { fontSize: 22 },
  rowLabel: { ...t.body, color: theme.text, fontWeight: "700" },
  rowHint: { ...t.caption, color: theme.textSubtle, marginTop: 2 },
  chevron: { ...t.body, color: theme.textSubtle, marginLeft: "auto" },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 4 },
  helper: { ...t.caption, color: theme.textSubtle, marginTop: spacing[2] },
  backWrap: { paddingHorizontal: spacing[4], marginTop: spacing[5] },
});
