/**
 * SM Live — useRoomSocket hook (Prompt 17).
 *
 * Wraps the Socket.IO connection to a single room. Provides:
 *   - viewerCount: live count from `room:viewer_count` events.
 *   - messages: chat messages from `chat:message` events.
 *   - roomEnded: true when `room:ended` fires.
 *   - kicked: true when `room:kicked` targets the current user.
 *   - send: emit a chat:message event.
 *   - leave: emit room:leave + disconnect.
 *
 * The hook owns the socket lifecycle — it connects on mount and
 * disconnects on unmount. It does NOT auto-reconnect (Socket.IO does
 * that internally) but it DOES handle the case where the room ends
 * while the user is connected: it surfaces `roomEnded` so the screen
 * can route back.
 *
 * The hook is safe to use in tests — when the API_BASE is unreachable,
 * the connect() promise rejects and the hook surfaces an error state
 * rather than hanging.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { tokenStore } from "../api/client";
import { API_BASE } from "../api/env";

export interface ChatMessage {
  from: { id: number; displayName: string; vipLevel?: number; nobleLevel?: number };
  text: string;
  ts: number;
}

export interface RoomSocketState {
  connected: boolean;
  viewerCount: number;
  messages: ChatMessage[];
  roomEnded: boolean;
  kicked: boolean;
  error: string | null;
  send: (text: string) => void;
  leave: () => void;
}

export function useRoomSocket(roomId: number, userId: number | null): RoomSocketState {
  const [connected, setConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomEnded, setRoomEnded] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;
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
        setConnected(true);
        setError(null);
        s?.emit("room:join", roomId, () => {});
      });

      s.on("disconnect", () => {
        setConnected(false);
      });

      s.on("connect_error", (err: Error) => {
        setError(err.message);
        setConnected(false);
      });

      s.on("room:viewer_count", (payload: { roomId: number; count: number }) => {
        if (payload.roomId === roomId) setViewerCount(payload.count);
      });

      s.on("chat:message", (m: ChatMessage) => {
        // Don't echo our own messages back — the send() function already
        // optimistically appends them.
        if (m.from.id !== userId) {
          setMessages((prev) => [...prev.slice(-80), m]);
        }
      });

      s.on("room:ended", () => {
        setRoomEnded(true);
      });

      s.on("room:kicked", (payload: { userId: number }) => {
        if (payload.userId === userId) setKicked(true);
      });

      s.on("gift:broadcast", (g: { name: string; from: { displayName: string }; quantity: number }) => {
        // Surface gift events as a system message so the chat shows them.
        setMessages((prev) => [...prev.slice(-80), {
          from: { id: 0, displayName: "🎁" },
          text: `${g.from.displayName} sent ${g.quantity}× ${g.name}`,
          ts: Date.now(),
        }]);
      });
    })();

    return () => {
      s?.disconnect();
      socketRef.current = null;
    };
  }, [roomId, userId]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !socketRef.current?.connected) return;
    // Optimistic append — our own message appears immediately.
    setMessages((prev) => [...prev.slice(-80), {
      from: { id: userId ?? 0, displayName: "me" },
      text: trimmed,
      ts: Date.now(),
    }]);
    socketRef.current?.emit("chat:send", { roomId, text: trimmed });
  }, [roomId, userId]);

  const leave = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("room:leave", roomId);
    }
    socketRef.current?.disconnect();
  }, [roomId]);

  return {
    connected,
    viewerCount,
    messages,
    roomEnded,
    kicked,
    error,
    send,
    leave,
  };
}
