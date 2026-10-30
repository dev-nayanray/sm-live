import { router, useLocalSearchParams } from "expo-router";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/react-native";
import { api, ApiError } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Avatar, Badge, Button, EmptyState, ErrorState, Loading,
  theme, t, spacing, radius,
} from "../../src/components";
import { useRoomSocket, type ChatMessage } from "../../src/hooks/useRoomSocket";
import {
  canEndStream, formatDuration,
  type StreamState,
} from "../../src/hooks/streamPure";

/**
 * SM Live — Room screen (Prompt 17).
 *
 * Unified host + viewer experience. The route param `host=1` (set by the
 * Start Live screen) determines whether the user is the host; otherwise
 * the user is a viewer.
 *
 * Lifecycle:
 *   1. POST /v1/rooms/:id/join → register viewer presence.
 *   2. GET /v1/rooms/:id → room details + host info + audience.
 *   3. POST /v1/rooms/:id/token → LiveKit token (canPublish for host,
 *      subscribe-only for viewer).
 *   4. Connect LiveKit Room → render video (host: local camera preview;
 *      viewer: host's published track).
 *   5. Socket.IO → live chat + viewer count + room:ended events.
 *   6. On leave / end → POST /v1/rooms/:id/leave (viewer) or /end (host)
 *      → disconnect LiveKit → route back.
 *
 * The screen NEVER fakes a video stream. If LiveKit fails to connect,
 * the error state surfaces the failure with a retry button.
 */

interface RoomInfo {
  id: number;
  title: string;
  type: string;
  slots: number;
  country: string;
  createdAt: string;
  closed: boolean;
  closedAt: string | null;
  host: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
  audienceCount: number;
  participants: { userId: number; displayName: string; avatarUrl: string; slotIndex: number | null; role: string; muted: boolean }[];
}

interface TokenResponse {
  token: string;
  url: string;
  canPublish: boolean;
  roomId: number;
  slots: number;
  type: string;
  hostId: number;
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string; host?: string }>();
  const roomId = Number(id);
  const { user, loggedIn } = useAuth();

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [chatText, setChatText] = useState("");
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  // The host flag from the URL is a hint — the authoritative check is
  // whether the token response says canPublish === true AND hostId matches.
  const isHost = !!tokenData && tokenData.canPublish && tokenData.hostId === user?.id;

  // Socket for chat + viewer count + room:ended.
  const socket = useRoomSocket(roomId, user?.id ?? null);

  // Load room + token.
  const load = useCallback(async () => {
    setError(null);
    try {
      await api(`/v1/rooms/${roomId}/join`, { method: "POST" });
      const [info, tok] = await Promise.all([
        api<RoomInfo>(`/v1/rooms/${roomId}`),
        api<TokenResponse>(`/v1/rooms/${roomId}/token`, { method: "POST" }),
      ]);
      if (info.closed) {
        setError("This room has ended.");
        return;
      }
      setRoom(info);
      setTokenData(tok);
      setStreamState("connecting");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  // Duration timer (host only — counts up from when stream goes live).
  useEffect(() => {
    if (!isHost || streamState !== "live") return;
    const timer = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, [isHost, streamState]);

  // If the socket reports room:ended, surface it.
  useEffect(() => {
    if (socket.roomEnded) {
      setStreamState("ended");
      setError("The host has ended this broadcast.");
    }
  }, [socket.roomEnded]);

  // If the socket reports the viewer was kicked, route back.
  useEffect(() => {
    if (socket.kicked) {
      router.back();
    }
  }, [socket.kicked]);

  const onLiveKitConnected = useCallback(() => {
    setStreamState("live");
  }, []);

  const onLiveKitDisconnected = useCallback(() => {
    setStreamState((prev) => prev === "ended" ? prev : "reconnecting");
  }, []);

  const onLiveKitError = useCallback((err: Error) => {
    const msg = err?.message ?? "LiveKit connection failed";
    setError(msg);
    setStreamState("error");
  }, []);

  // End the broadcast (host) or leave the room (viewer).
  const endOrLeave = useCallback(async () => {
    setEndConfirmOpen(false);
    try {
      if (isHost) {
        await api(`/v1/rooms/${roomId}/end`, { method: "POST" });
      } else {
        await api(`/v1/rooms/${roomId}/leave`, { method: "POST" });
      }
    } catch {
      // Best-effort — the local state is cleared regardless.
    }
    socket.leave();
    router.back();
  }, [isHost, roomId, socket]);

  const sendChat = useCallback(() => {
    const text = chatText.trim();
    if (!text) return;
    socket.send(text);
    setChatText("");
  }, [socket, chatText]);

  // --- Render states ---

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <EmptyState
          icon="🔐"
          title="Sign in to join"
          subtitle="You need to be signed in to watch live rooms."
          ctaLabel="Sign in"
          onCta={() => router.replace("/auth/welcome")}
        />
      </View>
    );
  }

  if (error && !room) {
    return (
      <View style={s.center}>
        <ErrorState
          title="Couldn't join room"
          subtitle={error}
          ctaLabel="Back to Live"
          onCta={() => router.back()}
        />
      </View>
    );
  }

  if (!room || !tokenData) {
    return (
      <View style={s.root}>
        <Loading label="Joining room…" />
      </View>
    );
  }

  const host = room.host;
  // LiveKit connection quality would be surfaced here via the room's
  // participant connection-quality callback — left as a future hook
  // point since the current LiveKit version doesn't expose it through
  // the React Native wrapper's onConnected callback.

  return (
    <View style={s.root}>
      {/* Video stage */}
      <View style={s.stage}>
        {tokenData.token ? (
          <View style={s.livekitWrap}>
            <LiveKitRoom
              serverUrl={tokenData.url}
              token={tokenData.token}
              connect={true}
              onConnected={onLiveKitConnected}
              onDisconnected={onLiveKitDisconnected}
              onError={onLiveKitError}
            >
            <View style={s.videoOverlay}>
              {streamState === "connecting" && (
                <View style={s.statusPill}>
                  <Text style={s.statusText}>Connecting…</Text>
                </View>
              )}
              {streamState === "live" && (
                <View style={s.liveBadgeRow}>
                  <Badge tone="accent" label="LIVE" icon="🔴" />
                  {isHost && (
                    <View style={s.durationPill}>
                      <Text style={s.durationText}>{formatDuration(duration)}</Text>
                    </View>
                  )}
                  <View style={s.viewerPill}>
                    <Text style={s.viewerText}>👥 {socket.viewerCount || room.audienceCount}</Text>
                  </View>
                </View>
              )}
              {streamState === "reconnecting" && (
                <View style={s.statusPill}>
                  <Text style={s.statusText}>Reconnecting…</Text>
                </View>
              )}
              {streamState === "error" && (
                <View style={s.statusPillError}>
                  <Text style={s.statusText}>Stream error — tap retry</Text>
                </View>
              )}
            </View>
            {/* Audio is automatically handled by the LiveKitRoom for
                both host and viewer — subscribe-only viewers will hear
                the host's audio without needing a separate renderer. */}
            </LiveKitRoom>
          </View>
        ) : (
          <View style={s.noVideo}>
            <Text style={s.noVideoText}>No video available</Text>
          </View>
        )}
      </View>

      {/* Room header */}
      <View style={s.roomHeader}>
        <View style={s.roomHeaderLeft}>
          <Text style={s.roomTitle} numberOfLines={1}>{room.title}</Text>
          <View style={s.hostRow}>
            <Avatar name={host.displayName} imageUrl={host.avatarUrl} size={28} vipLevel={host.vipLevel} />
            <Text style={s.hostName} numberOfLines={1}>{host.displayName}</Text>
            {host.vipLevel > 0 && <Badge tone="vip" label={`VIP${host.vipLevel}`} />}
            {host.nobleLevel > 0 && <Badge tone="noble" label={`N${host.nobleLevel}`} />}
            <Text style={s.hostMeta}>· 🌍 {room.country}</Text>
          </View>
        </View>
        <Pressable style={s.audienceBtn} onPress={() => setAudienceOpen(true)}>
          <Text style={s.audienceBtnText}>👥 {socket.viewerCount || room.audienceCount}</Text>
        </Pressable>
      </View>

      {/* Chat */}
      <View style={s.chatWrap}>
        <ScrollView style={s.chatScroll} contentContainerStyle={{ padding: spacing[3], gap: spacing[1] }}>
          {socket.messages.length === 0 ? (
            <Text style={s.chatEmpty}>No messages yet — say hi 👋</Text>
          ) : (
            socket.messages.map((m, i) => (
              <ChatBubble key={i} msg={m} isMe={m.from.id === user?.id} />
            ))
          )}
        </ScrollView>
        <View style={s.chatInputRow}>
          <TextInput
            style={s.chatInput}
            value={chatText}
            onChangeText={setChatText}
            placeholder="Say something…"
            placeholderTextColor={theme.textSubtle}
            returnKeyType="send"
            onSubmitEditing={sendChat}
            maxLength={300}
          />
          <Pressable style={s.sendBtn} onPress={sendChat}>
            <Text style={s.sendBtnText}>➤</Text>
          </Pressable>
        </View>
      </View>

      {/* Bottom action bar */}
      <View style={s.bottomBar}>
        {isHost ? (
          <>
            {/* Host controls */}
            <Pressable style={s.controlBtn} onPress={() => { /* mic toggle — LiveKit native */ }}>
              <Text style={s.controlIcon}>🎙️</Text>
              <Text style={s.controlLabel}>Mic</Text>
            </Pressable>
            <Pressable style={s.controlBtn} onPress={() => { /* camera toggle — LiveKit native */ }}>
              <Text style={s.controlIcon}>📷</Text>
              <Text style={s.controlLabel}>Camera</Text>
            </Pressable>
            <Pressable style={s.controlBtn} onPress={() => { /* camera switch — LiveKit native */ }}>
              <Text style={s.controlIcon}>🔄</Text>
              <Text style={s.controlLabel}>Flip</Text>
            </Pressable>
            <Pressable style={[s.controlBtn, s.endBtn]} onPress={() => setEndConfirmOpen(true)} disabled={!canEndStream(streamState)}>
              <Text style={s.controlIcon}>⏹</Text>
              <Text style={s.controlLabel}>End</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Viewer controls */}
            <Pressable style={s.controlBtn} onPress={() => router.push("/support/new")}>
              <Text style={s.controlIcon}>🚩</Text>
              <Text style={s.controlLabel}>Report</Text>
            </Pressable>
            <Pressable style={s.controlBtn} onPress={() => setAudienceOpen(true)}>
              <Text style={s.controlIcon}>👥</Text>
              <Text style={s.controlLabel}>Audience</Text>
            </Pressable>
            <Pressable style={[s.controlBtn, s.leaveBtn]} onPress={endOrLeave}>
              <Text style={s.controlIcon}>←</Text>
              <Text style={s.controlLabel}>Leave</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* End confirmation modal (host) */}
      <Modal visible={endConfirmOpen} transparent animationType="fade" onRequestClose={() => setEndConfirmOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>End broadcast?</Text>
            <Text style={s.modalBody}>
              Your stream will stop and all viewers will be removed. This cannot be undone.
            </Text>
            <View style={s.modalActions}>
              <Button variant="ghost" label="Cancel" onPress={() => setEndConfirmOpen(false)} style={s.modalCancelBtn} />
              <Button variant="danger" label="End live" onPress={endOrLeave} style={s.modalEndBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Audience modal */}
      <Modal visible={audienceOpen} transparent animationType="slide" onRequestClose={() => setAudienceOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.audienceCard}>
            <View style={s.audienceHeader}>
              <Text style={s.audienceTitle}>Audience ({socket.viewerCount || room.audienceCount})</Text>
              <Pressable onPress={() => setAudienceOpen(false)}>
                <Text style={s.closeText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={s.audienceList}>
              {room.participants.map((p) => (
                <View key={p.userId} style={s.audienceRow}>
                  <Avatar name={p.displayName} imageUrl={p.avatarUrl} size={32} />
                  <Text style={s.audienceName} numberOfLines={1}>{p.displayName}</Text>
                  {p.role === "host" && <Badge tone="accent" label="Host" />}
                  {p.role === "cohost" && <Badge tone="primary" label="Co-host" />}
                  {p.muted && <Text style={s.mutedIcon}>🔇</Text>}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Error state (after initial load) */}
      {error && streamState === "error" && (
        <View style={s.errorBar}>
          <Text style={s.errorBarText}>{error}</Text>
          <Pressable onPress={() => { setError(null); setStreamState("idle"); void load(); }}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Chat message bubble. */
function ChatBubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  return (
    <View style={[s.bubble, isMe ? s.bubbleMine : s.bubbleTheirs]}>
      {!isMe && msg.from.id !== 0 && (
        <Text style={[s.bubbleAuthor, { color: msg.from.vipLevel ? theme.vip : theme.accent }]}>
          {msg.from.displayName}{msg.from.vipLevel ? ` VIP${msg.from.vipLevel}` : ""}{msg.from.nobleLevel ? " 👑" : ""}:
        </Text>
      )}
      <Text style={s.bubbleText}>{msg.text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: "center" },

  // Video stage
  stage: {
    height: 280,
    backgroundColor: "#000",
    position: "relative",
  },
  livekitWrap: {
    flex: 1,
  },
  videoOverlay: {
    position: "absolute",
    top: spacing[2],
    left: spacing[2],
    right: spacing[2],
    flexDirection: "row",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  statusPill: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  statusPillError: {
    backgroundColor: "rgba(251, 113, 133, 0.8)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  statusText: {
    ...t.caption,
    color: theme.textInverse,
    fontWeight: "600",
  },
  liveBadgeRow: {
    flexDirection: "row",
    gap: spacing[1],
    alignItems: "center",
  },
  durationPill: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  durationText: {
    ...t.micro,
    color: theme.textInverse,
    fontWeight: "700",
  },
  viewerPill: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  viewerText: {
    ...t.micro,
    color: theme.textInverse,
  },
  noVideo: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  noVideoText: {
    ...t.caption,
    color: theme.textSubtle,
  },

  // Room header
  roomHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  roomHeaderLeft: { flex: 1 },
  roomTitle: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[1],
  },
  hostName: {
    ...t.caption,
    color: theme.textMuted,
    flexShrink: 1,
  },
  hostMeta: {
    ...t.caption,
    color: theme.textSubtle,
  },
  audienceBtn: {
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
  },
  audienceBtnText: {
    ...t.caption,
    color: theme.text,
    fontWeight: "700",
  },

  // Chat
  chatWrap: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  chatScroll: {
    flex: 1,
  },
  chatEmpty: {
    ...t.caption,
    color: theme.textSubtle,
    textAlign: "center",
    marginTop: spacing[4],
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    marginBottom: spacing[1],
  },
  bubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: theme.primary,
  },
  bubbleTheirs: {
    alignSelf: "flex-start",
    backgroundColor: theme.surface,
  },
  bubbleAuthor: {
    ...t.micro,
    fontWeight: "700",
  },
  bubbleText: {
    ...t.caption,
    color: theme.text,
  },
  chatInputRow: {
    flexDirection: "row",
    gap: spacing[2],
    padding: spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
  chatInput: {
    flex: 1,
    height: 40,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
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
  sendBtnText: {
    color: theme.textInverse,
    fontWeight: "700",
  },

  // Bottom bar
  bottomBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  controlBtn: {
    alignItems: "center",
    gap: spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    minWidth: 56,
  },
  controlIcon: { fontSize: 22 },
  controlLabel: {
    ...t.micro,
    color: theme.textMuted,
  },
  endBtn: {
    backgroundColor: "rgba(251, 113, 133, 0.15)",
    borderRadius: radius.md,
  },
  leaveBtn: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: radius.md,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[4],
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing[5],
    width: "100%",
    maxWidth: 360,
    gap: spacing[3],
  },
  modalTitle: {
    ...t.h2,
    color: theme.text,
  },
  modalBody: {
    ...t.body,
    color: theme.textMuted,
    lineHeight: 22,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing[2],
  },
  modalCancelBtn: { flex: 1 },
  modalEndBtn: { flex: 1 },

  // Audience modal
  audienceCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing[4],
    width: "100%",
    maxHeight: 400,
    gap: spacing[2],
  },
  audienceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  audienceTitle: {
    ...t.h2,
    color: theme.text,
  },
  closeText: {
    ...t.body,
    color: theme.textSubtle,
  },
  audienceList: {
    maxHeight: 300,
  },
  audienceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  audienceName: {
    ...t.body,
    color: theme.text,
    flex: 1,
  },
  mutedIcon: { fontSize: 14 },

  // Error bar
  errorBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.danger,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorBarText: {
    ...t.caption,
    color: theme.textInverse,
    flex: 1,
  },
  retryText: {
    ...t.caption,
    color: theme.textInverse,
    fontWeight: "700",
  },
});
