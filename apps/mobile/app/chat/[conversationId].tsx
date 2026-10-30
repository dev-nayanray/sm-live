import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Avatar, ErrorState, Loading,
  theme, t, spacing, radius,
} from "../../src/components";
import { useChat } from "../../src/hooks/useChat";
import {
  formatMessageTime, isSameDay, type MessageView,
} from "../../src/hooks/chatPure";

/**
 * SM Live — Chat conversation screen (Prompt 19).
 *
 * Full 1:1 + group chat experience:
 *   - Message history (paginated, oldest at top).
 *   - Real-time incoming messages via dm:message socket event.
 *   - Send messages via POST /v1/messages/conversations/:id/messages.
 *   - Mark as read on connect.
 *   - Typing indicator via dm:typing.
 *   - Message bubbles: mine (right, brand) vs theirs (left, surface).
 *   - Date separators between days.
 *   - Composer: text input + send button + sending state.
 *   - Back button → messages tab.
 *   - Conversation header: avatar, title, participant count (group).
 *
 * The screen uses the useChat hook which owns the socket lifecycle.
 */
interface ConversationDetail {
  id: number;
  type: string;
  title: string;
  participants: { userId: number; role: string; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number }[];
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const { user, loggedIn } = useAuth();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const chat = useChat(conversationId, user?.id ?? null, loggedIn);

  // Load conversation details.
  useEffect(() => {
    if (!loggedIn) return;
    api<ConversationDetail>(`/v1/messages/conversations/${conversationId}`)
      .then(setConv)
      .catch((e) => setLoadError((e as Error).message));
  }, [conversationId, loggedIn]);

  // Scroll to bottom when new messages arrive.
  useEffect(() => {
    if (chat.messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chat.messages.length]);

  const onSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || chat.sending) return;
    void chat.send(trimmed).then((msgId) => {
      if (msgId !== null) setText("");
    });
  }, [text, chat]);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <ErrorState title="Sign in required" subtitle="You need to be signed in to view messages." ctaLabel="Sign in" onCta={() => router.replace("/auth/welcome")} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={s.center}>
        <ErrorState title="Couldn't open conversation" subtitle={loadError} ctaLabel="Back" onCta={() => router.back()} />
      </View>
    );
  }

  if (!conv) {
    return <Loading label="Loading conversation…" />;
  }

  const title = conv.type === "group"
    ? (conv.title || "Group Chat")
    : (conv.participants.find((p) => p.userId !== user?.id)?.displayName ?? "Unknown");
  const otherAvatar = conv.type === "group"
    ? undefined
    : conv.participants.find((p) => p.userId !== user?.id)?.avatarUrl;
  const otherVip = conv.participants.find((p) => p.userId !== user?.id)?.vipLevel ?? 0;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Avatar name={title} imageUrl={otherAvatar} size={36} vipLevel={otherVip} />
        <View style={s.headerInfo}>
          <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
          {conv.type === "group" && (
            <Text style={s.headerSub}>{conv.participants.length} members</Text>
          )}
          {chat.typingUsers.length > 0 && (
            <Text style={s.typingText}>typing…</Text>
          )}
        </View>
      </View>

      {/* Messages */}
      {chat.loading ? (
        <Loading label="Loading messages…" />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={s.messagesScroll}
          contentContainerStyle={{ padding: spacing[3], gap: spacing[1] }}
          onScroll={({ nativeEvent }) => {
            // Load more when near the top.
            if (nativeEvent.contentOffset.y < 50 && chat.hasMore && !chat.loading) {
              void chat.loadMore();
            }
          }}
          scrollEventThrottle={400}
        >
          {chat.messages.length === 0 ? (
            <Text style={s.emptyText}>No messages yet — say hi 👋</Text>
          ) : (
            chat.messages.map((msg, i) => {
              const showDateSep = i === 0 || !isSameDay(
                new Date(chat.messages[i - 1]!.createdAt),
                new Date(msg.createdAt),
              );
              return (
                <View key={msg.id}>
                  {showDateSep && <DateSeparator date={msg.createdAt} />}
                  <MessageBubble msg={msg} isMine={msg.senderId === user?.id} />
                </View>
              );
            })
          )}
          {chat.error && (
            <View style={s.errorPill}>
              <Text style={s.errorPillText}>⚠️ {chat.error}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Composer */}
      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={(v) => { setText(v); chat.setTyping(v.length > 0); }}
          placeholder="Type a message…"
          placeholderTextColor={theme.textSubtle}
          multiline
          maxLength={300}
          returnKeyType="send"
          onSubmitEditing={onSend}
        />
        <Pressable
          style={[s.sendBtn, (!text.trim() || chat.sending) && s.sendBtnDisabled]}
          onPress={onSend}
          disabled={!text.trim() || chat.sending}
        >
          <Text style={s.sendBtnText}>{chat.sending ? "…" : "➤"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MessageBubble({ msg, isMine }: { msg: MessageView; isMine: boolean }) {
  return (
    <View style={[s.bubbleWrap, isMine ? s.bubbleWrapMine : s.bubbleWrapTheirs]}>
      {!isMine && (
        <Text style={[s.bubbleSender, { color: msg.sender.vipLevel ? theme.vip : theme.accent }]}>
          {msg.sender.displayName}{msg.sender.vipLevel ? ` VIP${msg.sender.vipLevel}` : ""}
        </Text>
      )}
      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs]}>
        <Text style={s.bubbleText}>{msg.body}</Text>
      </View>
      <Text style={s.bubbleTime}>{formatMessageTime(msg.createdAt)}</Text>
    </View>
  );
}

function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <View style={s.dateSep}>
      <View style={s.dateSepLine} />
      <Text style={s.dateSepText}>{label}</Text>
      <View style={s.dateSepLine} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center", backgroundColor: theme.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  backIcon: { fontSize: 18, color: theme.text },
  headerInfo: { flex: 1, gap: 1 },
  headerTitle: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  headerSub: {
    ...t.micro,
    color: theme.textSubtle,
  },
  typingText: {
    ...t.micro,
    color: theme.primaryMuted,
    fontStyle: "italic",
  },

  // Messages
  messagesScroll: { flex: 1 },
  emptyText: {
    ...t.body,
    color: theme.textSubtle,
    textAlign: "center",
    marginTop: spacing[6],
  },

  // Bubble
  bubbleWrap: {
    maxWidth: "80%",
    marginVertical: spacing[1],
  },
  bubbleWrapMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubbleWrapTheirs: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubbleSender: {
    ...t.micro,
    fontWeight: "700",
    marginBottom: 2,
  },
  bubble: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: theme.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    backgroundColor: theme.surface,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleText: {
    ...t.body,
    color: theme.textInverse,
  },
  bubbleTime: {
    ...t.micro,
    color: theme.textSubtle,
    marginTop: 2,
  },

  // Date separator
  dateSep: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginVertical: spacing[2],
  },
  dateSepLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.border,
  },
  dateSepText: {
    ...t.micro,
    color: theme.textSubtle,
  },

  // Error pill
  errorPill: {
    backgroundColor: "rgba(251, 113, 133, 0.12)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    marginTop: spacing[2],
  },
  errorPillText: {
    ...t.caption,
    color: theme.danger,
  },

  // Composer
  composer: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[2],
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    ...t.body,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: theme.surfaceAlt,
  },
  sendBtnText: {
    color: theme.textInverse,
    fontWeight: "700",
    fontSize: 16,
  },
});
