/**
 * SM Live — pure chat helpers (Prompt 19).
 *
 * Pure functions used by the messaging screens. Extracted so the test
 * suite can verify behaviour without mounting React or connecting to
 * Socket.IO.
 *
 * Functions:
 *   - sortConversations        → sort by pinned first, then lastMessageAt desc.
 *   - formatMessageTime        → "10:30 AM" for today, "Oct 5" for older.
 *   - getMessagePreview        → truncated message body for conversation list.
 *   - getConversationTitle      → group title or other participant's name.
 *   - getConversationAvatar     → other participant's avatar (1:1 only).
 *   - countUnread               → count conversations with unread > 0.
 *   - filterConversations       → search + category filter.
 *   - dedupeMessages            → remove duplicate message IDs (defence-in-depth).
 *   - isSameDay                  → check if two timestamps are on the same day.
 */

export interface ConversationListItem {
  id: number;
  type: string; // private | group
  title: string;
  lastMessageAt: string | null;
  muted: boolean;
  pinned: boolean;
  lastReadAt: string | null;
  unread: number;
  participants: { userId: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number }[];
  lastMessage: { id: number; body: string; senderId: number; createdAt: string } | null;
}

export interface MessageView {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  createdAt: string;
  sender: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
}

/**
 * Sort conversations: pinned first, then by lastMessageAt descending.
 * Conversations with no messages sort to the bottom.
 */
export function sortConversations(convs: ConversationListItem[]): ConversationListItem[] {
  return [...convs].sort((a, b) => {
    // Pinned first.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    // Then by lastMessageAt desc.
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });
}

/** Format a message timestamp for the conversation list. */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (isSameDay(then, now)) {
    return then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }
  // Within the last 7 days → show day name.
  const diffDays = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return then.toLocaleDateString("en-US", { weekday: "short" });
  }
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Get a truncated preview of the last message. */
export function getMessagePreview(msg: { body: string } | null, maxLength: number = 40): string {
  if (!msg) return "No messages yet";
  const body = msg.body.trim();
  if (body.length <= maxLength) return body;
  return body.slice(0, maxLength - 1) + "…";
}

/**
 * Get the display title for a conversation. For group chats, use the
 * conversation title. For 1:1 chats, use the OTHER participant's name.
 */
export function getConversationTitle(conv: ConversationListItem, currentUserId: number): string {
  if (conv.type === "group" || conv.participants.length > 2) {
    return conv.title || "Group Chat";
  }
  const other = conv.participants.find((p) => p.userId !== currentUserId);
  return other?.displayName ?? "Unknown";
}

/**
 * Get the avatar URL for a 1:1 conversation (the other participant's).
 * Returns empty string for group chats (groups would use a group avatar).
 */
export function getConversationAvatar(conv: ConversationListItem, currentUserId: number): string {
  if (conv.type === "group") return "";
  const other = conv.participants.find((p) => p.userId !== currentUserId);
  return other?.avatarUrl ?? "";
}

/** Count conversations with unread > 0. */
export function countUnread(convs: ConversationListItem[]): number {
  return convs.filter((c) => c.unread > 0).length;
}

/** Filter conversations by search query + category. */
export function filterConversations(
  convs: ConversationListItem[],
  query: string,
  category: "all" | "private" | "group" | "unread" = "all",
): ConversationListItem[] {
  const q = query.trim().toLowerCase();
  return convs.filter((c) => {
    // Category filter.
    if (category === "private" && c.type !== "private") return false;
    if (category === "group" && c.type !== "group") return false;
    if (category === "unread" && c.unread === 0) return false;
    // Search filter — match title or participant names.
    if (q) {
      const title = getConversationTitle(c, 0).toLowerCase(); // 0 = any user for search
      const participantMatch = c.participants.some((p) =>
        p.displayName.toLowerCase().includes(q),
      );
      if (!title.includes(q) && !participantMatch) return false;
    }
    return true;
  });
}

/** Remove duplicate messages by ID (defence-in-depth for real-time + paginated lists). */
export function dedupeMessages(messages: MessageView[]): MessageView[] {
  const seen = new Set<number>();
  const out: MessageView[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Check if two timestamps fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
