/**
 * SM Live — useConversations hook (Prompt 19).
 *
 * Manages the conversation list: fetches from /v1/messages/conversations,
 * subscribes to real-time dm:message events to update the preview +
 * unread count without polling, and provides a refresh() method for
 * pull-to-refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "../api/client";
import { tokenStore } from "../api/client";
import { API_BASE } from "../api/env";
import { sortConversations, type ConversationListItem } from "./chatPure";

export interface ConversationsState {
  conversations: ConversationListItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useConversations(enabled: boolean): ConversationsState {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ items: ConversationListItem[] }>("/v1/messages/conversations?page=1&pageSize=50");
      setConversations(sortConversations(data.items));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // Subscribe to dm:message events so the conversation list updates in
  // real-time when a new message arrives in any conversation.
  useEffect(() => {
    if (!enabled) return;
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

      s.on("dm:message", (payload: { conversationId: number; message: { id: number; body: string; senderId: number; createdAt: string } }) => {
        setConversations((prev) => {
          return prev.map((c) => {
            if (c.id !== payload.conversationId) return c;
            return {
              ...c,
              lastMessage: {
                id: payload.message.id,
                body: payload.message.body,
                senderId: payload.message.senderId,
                createdAt: payload.message.createdAt,
              },
              lastMessageAt: payload.message.createdAt,
              unread: c.unread + 1,
            };
          });
        });
      });
    })();
    return () => { s?.disconnect(); socketRef.current = null; };
  }, [enabled]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  return { conversations, loading, refreshing, error, refresh };
}
