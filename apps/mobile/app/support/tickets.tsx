import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { Button, Card, EmptyState, SectionHeader, theme, t, spacing } from "../../src/components";

/**
 * SM Live — Browse my tickets (Prompt 13).
 *
 * Backend contract exists (Prompt 11: GET /v1/support/tickets returns the
 * tickets owned by the calling user — admin variant at /v1/admin/support/*).
 * The user-facing endpoint is NOT yet exposed; this screen is an honest
 * placeholder that explains what's coming.
 *
 * When /v1/support/tickets lands, swap the EmptyState for a real list
 * using the existing `api()` client + the design-system Card + Avatar
 * components.
 */
export default function MyTickets() {
  return (
    <ScrollView style={s.root} contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing[6] }}>
      <Text style={s.title}>My support tickets</Text>

      <Card>
        <SectionHeader title="Status" icon="ℹ️" />
        <Text style={s.body}>
          The backend can already accept tickets (Prompt 11 added the SupportTicket +
          TicketMessage models + admin endpoints). The user-facing
          <Text style={s.mono}> GET /v1/support/tickets</Text> route is being designed.
        </Text>
      </Card>

      <EmptyState
        icon="🎫"
        title="No tickets to show yet"
        subtitle="Once the user-facing ticket list is live, your open and closed tickets will appear here."
        ctaLabel="Open a ticket"
        onCta={() => router.push("/support/new")}
      />

      <Pressable style={s.backWrap} onPress={() => router.back()}>
        <Button variant="ghost" label="← back" />
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  title: { ...t.h1, color: theme.text, paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  body: { ...t.body, color: theme.textMuted, lineHeight: 22 },
  mono: { ...t.caption, fontFamily: "monospace", color: theme.primaryMuted },
  backWrap: { paddingHorizontal: spacing[4], marginTop: spacing[5] },
});
