/**
 * SM Live — useChat hook (Prompt 19).
 *
 * Per-conversation hook that:
 *   1. Loads paginated message history from the API.
 *   2. Connects to Socket.IO + joins the conversation room (dm:join).
 *   3. Receives real-time dm:message events → appends to messages.
 *   4. Sends messages via POST /v1/messages/conversations/:id/messages.
 *   5. Marks as read via POST /v1/messages/conversations/:id/read.
 *   6. Handles typing indicators (dm:typing).
 *   7. Cleans up the socket on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, tokenStore, ApiError } from "../api/client";
import { API_BASE } from "../api/env";
import { dedupeMessages, type MessageView } from "./chatPure";

export interface TypingUser { userId: number; typing: boolean }

export interface ChatState {
  messages: MessageView[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  typingUsers: number[]; // user IDs currently typing
  /** Send a text message. Returns the message ID on success. */
  send: (text: string) => Promise<number | null>;
  /** Mark the conversation as read (best-effort). */
  markRead: () => void;
  /** Load older messages (pagination). */
  loadMore: () => Promise<void>;
  /** Has more messages to load. */
  hasMore: boolean;
  /** Emit a typing indicator. */
  setTyping: (typing: boolean) => void;
}

export function useChat(conversationId: number, userId: number | null, enabled: boolean): ChatState {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<number[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const socketRef = useRef<Socket | null>(null);

  // Load message history.
  const load = useCallback(async (pageNum: number) => {
    setError(null);
    try {
      const data = await api<{ items: MessageView[]; total: number; page: number; pageSize: number }>(
        `/v1/messages/conversations/${conversationId}/messages?page=${pageNum}&pageSize=50`,
      );
      setMessages((prev) => dedupeMessages(pageNum === 1 ? data.items : [...data.items, ...prev]));
      setHasMore(data.items.length >= data.pageSize);
      setPage(pageNum);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;
    void load(1);
  }, [enabled, load]);

  // Connect to Socket.IO + join the conversation room.
  useEffect(() => {
    if (!enabled || !userId) return;
    let s: Socket | null = null;
    (async () => {
      const tokens = await tokenStore.get();
      s = io(API_BASE, {
        auth: { token: tokens?.accessToken },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      socketRef.current = s;

      s.on("connect", () => {
        s?.emit("dm:join", conversationId, () => {});
        // Mark as read on connect.
        void api(`/v1/messages/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
      });

      s.on("dm:message", (payload: { conversationId: number; message: MessageView }) => {
        if (payload.conversationId === conversationId) {
          setMessages((prev) => dedupeMessages([...prev, payload.message]));
          // Mark as read if the message is from someone else.
          if (payload.message.senderId !== userId) {
            void api(`/v1/messages/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
          }
        }
      });

      s.on("dm:typing", (payload: { conversationId: number; userId: number; typing: boolean }) => {
        if (payload.conversationId !== conversationId) return;
        setTypingUsers((prev) => {
          if (payload.typing) {
            return prev.includes(payload.userId) ? prev : [...prev, payload.userId];
          }
          return prev.filter((id) => id !== payload.userId);
        });
      });

      s.on("dm:read", () => {
        // The other participant read our messages — we could update
        // read receipts here. For now, this is a no-op since the
        // message status is derived from the conversation's lastReadAt.
      });
    })();

    return () => {
      s?.emit("dm:leave", conversationId);
      s?.disconnect();
      socketRef.current = null;
    };
  }, [conversationId, userId, enabled]);

  const send = useCallback(async (text: string): Promise<number | null> => {
    const trimmed = text.trim();
    if (!trimmed || sending) return null;
    setSending(true);
    setError(null);
    try {
      const res = await api<{ id: number }>(`/v1/messages/conversations/${conversationId}/messages`, {
        method: "POST",
        json: { body: trimmed },
      });
      // Optimistic append — the server will also emit dm:message but we
      // add it immediately so the UI feels instant. The dedupe in the
      // dm:message handler prevents the double-add.
      setMessages((prev) => dedupeMessages([...prev, {
        id: res.id,
        conversationId,
        senderId: userId ?? 0,
        body: trimmed,
        createdAt: new Date().toISOString(),
        sender: {
          id: userId ?? 0,
          displayName: "me",
          avatarUrl: "",
          vipLevel: 0,
          nobleLevel: 0,
        },
      }]));
      return res.id;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
      return null;
    } finally {
      setSending(false);
    }
  }, [conversationId, userId, sending]);

  const markRead = useCallback(() => {
    void api(`/v1/messages/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    await load(page + 1);
  }, [loading, hasMore, page, load]);

  const setTyping = useCallback((typing: boolean) => {
    socketRef.current?.emit("dm:typing", { conversationId, typing });
  }, [conversationId]);

  return {
    messages,
    loading,
    sending,
    error,
    typingUsers,
    send,
    markRead,
    loadMore,
    hasMore,
    setTyping,
  };
}
