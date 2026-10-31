import { router, useLocalSearchParams } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { Badge, Button, ErrorState, Input, Loading, theme, t, spacing, radius } from "../../src/components";
import { ticketStatusLabel, ticketStatusTone, formatNotificationTime } from "../../src/hooks/notificationPure";

interface TicketMessage {
  id: number; body: string; authorType: string; createdAt: string;
}
interface TicketDetail {
  id: number; subject: string; description: string; category: string;
  priority: string; status: string; createdAt: string; updatedAt: string;
  messages: TicketMessage[];
}

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = Number(id);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<TicketDetail>(`/v1/support/tickets/${ticketId}`);
      setTicket(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);

  const onSend = async () => {
    if (sending || !reply.trim() || !ticket) return;
    setSending(true);
    try {
      await api(`/v1/support/tickets/${ticketId}/messages`, {
        method: "POST",
        json: { body: reply.trim() },
      });
      setReply("");
      await load(); // refresh messages
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Loading label="Loading ticket…" />;
  if (error || !ticket) return <ErrorState title="Couldn't load ticket" subtitle={error ?? "Not found"} ctaLabel="Back" onCta={() => router.back()} />;

  const isClosed = ticket.status === "closed";

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}><Text style={s.backIcon}>←</Text></Pressable>
        <View style={s.headerInfo}>
          <Text style={s.subject} numberOfLines={1}>{ticket.subject}</Text>
          <View style={s.badgeRow}>
            <Badge tone={ticketStatusTone(ticket.status)} label={ticketStatusLabel(ticket.status)} />
            <Badge tone="muted" label={ticket.category} />
            <Badge tone="muted" label={ticket.priority} />
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={ticket.messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: spacing[3], gap: spacing[2] }}
        ListHeaderComponent={
          <View style={s.originalMsg}>
            <Text style={s.originalLabel}>Original Issue:</Text>
            <Text style={s.originalBody}>{ticket.description}</Text>
            <Text style={s.originalTime}>{formatNotificationTime(ticket.createdAt)}</Text>
          </View>
        }
        renderItem={({ item: m }) => (
          <View style={[s.bubble, m.authorType === "user" ? s.bubbleUser : s.bubbleAdmin]}>
            <Text style={s.bubbleAuthor}>{m.authorType === "user" ? "You" : "Support"}</Text>
            <Text style={s.bubbleBody}>{m.body}</Text>
            <Text style={s.bubbleTime}>{formatNotificationTime(m.createdAt)}</Text>
          </View>
        )}
      />

      {!isClosed && (
        <View style={s.composer}>
          <Input
            value={reply}
            onChangeText={setReply}
            placeholder="Type your reply…"
            multiline
            maxLength={2000}
            style={{ flex: 1, minHeight: 40, maxHeight: 80 }}
          />
          <Button label="Send" onPress={onSend} loading={sending} disabled={sending || !reply.trim()} style={{ height: 40, paddingHorizontal: spacing[3] }} />
        </View>
      )}
      {isClosed && (
        <View style={s.closedBanner}>
          <Text style={s.closedText}>This ticket is closed. Create a new ticket if you need further help.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 18, color: theme.text },
  headerInfo: { flex: 1, gap: 2 },
  subject: { ...t.body, color: theme.text, fontWeight: "700" },
  badgeRow: { flexDirection: "row", gap: spacing[1] },
  originalMsg: { backgroundColor: "rgba(124,58,237,0.12)", borderRadius: radius.lg, padding: spacing[3], marginBottom: spacing[2], gap: spacing[1] },
  originalLabel: { ...t.micro, color: theme.primaryMuted, fontWeight: "700", textTransform: "uppercase" },
  originalBody: { ...t.body, color: theme.text },
  originalTime: { ...t.micro, color: theme.textSubtle },
  bubble: { maxWidth: "85%", paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.lg, gap: 2 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: theme.primary },
  bubbleAdmin: { alignSelf: "flex-start", backgroundColor: theme.surface },
  bubbleAuthor: { ...t.micro, fontWeight: "700", color: theme.textInverse },
  bubbleBody: { ...t.body, color: theme.textInverse },
  bubbleTime: { ...t.micro, color: theme.textInverse, opacity: 0.7 },
  composer: { flexDirection: "row", gap: spacing[2], padding: spacing[2], backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border },
  closedBanner: { padding: spacing[3], backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center" },
  closedText: { ...t.caption, color: theme.warning, textAlign: "center" },
});
