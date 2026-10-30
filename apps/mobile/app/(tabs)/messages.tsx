import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/state/AppProviders";
import {
  Avatar, EmptyState, ErrorState, Loading, TopHeader,
  theme, t, spacing, radius,
} from "../../src/components";
import { useConversations } from "../../src/hooks/useConversations";
import {
  formatMessageTime, getMessagePreview,
  getConversationTitle, getConversationAvatar, filterConversations,
  type ConversationListItem,
} from "../../src/hooks/chatPure";

/**
 * SM Live — Messages tab (Prompt 19).
 *
 * Real conversation list backed by /v1/messages/conversations. Replaces
 * the Prompt 13 placeholder that showed the lobby + recent rooms. The
 * conversation list updates in real-time via the useConversations hook
 * which subscribes to dm:message socket events.
 *
 * Features:
 *   - TopHeader with brand + search + notifications + wallet + avatar.
 *   - Category tabs: All / Private / Unread.
 *   - "New chat" button → /chat/new (search for a user to start a DM).
 *   - Pull-to-refresh.
 *   - Real-time conversation preview updates.
 *   - Per-conversation: avatar, name, last message preview, timestamp,
 *     unread badge.
 *   - Tapping a conversation → /chat/[conversationId].
 *   - Loading / empty / error states.
 */

type Category = "all" | "private" | "unread";

const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "unread", label: "Unread" },
];

export default function MessagesTab() {
  const { loggedIn, user } = useAuth();
  const { conversations, loading, refreshing, error, refresh } = useConversations(loggedIn);
  const [category, setCategory] = useState<Category>("all");

  if (!loggedIn) {
    return (
      <View style={s.root}>
        <TopHeader />
        <View style={s.center}>
          <EmptyState
            icon="🔐"
            title="Sign in to see your messages"
            subtitle="Private conversations, group chats, and real-time messaging."
            ctaLabel="Sign in"
            onCta={() => router.replace("/auth/welcome")}
          />
        </View>
      </View>
    );
  }

  const filtered = filterConversations(conversations, "", category);

  return (
    <View style={s.root}>
      <TopHeader />
      <View style={s.headerRow}>
        <Text style={s.title}>Messages</Text>
        <Pressable style={s.newBtn} onPress={() => router.push("/chat/new")}>
          <Text style={s.newBtnText}>+ New</Text>
        </Pressable>
      </View>
      <View style={s.tabs}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => setCategory(c.key)}
            style={[s.tab, category === c.key && s.tabActive]}
          >
            <Text style={[s.tabText, category === c.key && s.tabTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <Loading label="Loading conversations…" />
      ) : error ? (
        <ErrorState
          title="Couldn't load messages"
          subtitle="Pull down to retry."
          technical={error}
          ctaLabel="Retry"
          onCta={() => void refresh()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="💬"
          title={category === "unread" ? "No unread messages" : "No conversations yet"}
          subtitle={category === "unread"
            ? "You're all caught up!"
            : "Tap '+ New' to start a conversation with someone."}
          ctaLabel={category === "all" ? "Start a chat" : undefined}
          onCta={category === "all" ? () => router.push("/chat/new") : undefined}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.primary} />}
          contentContainerStyle={{ paddingVertical: spacing[2] }}
          renderItem={({ item }) => (
            <ConversationRow conv={item} currentUserId={user?.id ?? 0} />
          )}
        />
      )}
    </View>
  );
}

function ConversationRow({ conv, currentUserId }: { conv: ConversationListItem; currentUserId: number }) {
  const title = getConversationTitle(conv, currentUserId);
  const avatar = getConversationAvatar(conv, currentUserId);
  const preview = getMessagePreview(conv.lastMessage);
  const time = conv.lastMessageAt ? formatMessageTime(conv.lastMessageAt) : "";
  const isGroup = conv.type === "group";

  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      onPress={() => router.push(`/chat/${conv.id}`)}
    >
      <View style={s.avatarWrap}>
        <Avatar
          name={title}
          imageUrl={avatar || undefined}
          size={48}
          vipLevel={conv.participants.find((p) => p.userId !== currentUserId)?.vipLevel}
        />
        {isGroup && <View style={s.groupBadge}><Text style={s.groupBadgeText}>👥</Text></View>}
      </View>
      <View style={s.rowBody}>
        <View style={s.rowHeader}>
          <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={s.rowTime}>{time}</Text>
        </View>
        <View style={s.rowFooter}>
          <Text style={[s.rowPreview, conv.unread > 0 && s.rowPreviewUnread]} numberOfLines={1}>
            {conv.lastMessage?.senderId === currentUserId ? "You: " : ""}
            {preview}
          </Text>
          {conv.unread > 0 && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadText}>{conv.unread > 99 ? "99+" : conv.unread}</Text>
            </View>
          )}
          {conv.muted && <Text style={s.mutedIcon}>🔕</Text>}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  title: { ...t.h1, color: theme.text },
  newBtn: {
    backgroundColor: theme.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  newBtnText: {
    ...t.caption,
    color: theme.textInverse,
    fontWeight: "700",
  },
  tabs: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  tab: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  tabActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  tabText: {
    ...t.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  tabTextActive: {
    color: theme.textInverse,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  avatarWrap: {
    position: "relative",
  },
  groupBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  groupBadgeText: { fontSize: 10 },
  rowBody: {
    flex: 1,
    gap: spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowTitle: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
    flex: 1,
  },
  rowTime: {
    ...t.micro,
    color: theme.textSubtle,
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  rowPreview: {
    ...t.caption,
    color: theme.textSubtle,
    flex: 1,
  },
  rowPreviewUnread: {
    color: theme.text,
    fontWeight: "600",
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: {
    color: theme.textInverse,
    fontSize: 10,
    fontWeight: "800",
  },
  mutedIcon: { fontSize: 12 },
});
