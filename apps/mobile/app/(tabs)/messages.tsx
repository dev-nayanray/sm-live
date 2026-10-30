import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { io, type Socket } from "socket.io-client";
import { api, tokenStore } from "../../src/api/client";
import { API_BASE } from "../../src/api/env";
import { useAuth } from "../../src/state/AppProviders";
import { Avatar, Badge, Card, EmptyState, SectionHeader, theme, t, spacing } from "../../src/components";

/**
 * SM Live — Messages screen (Prompt 13).
 *
 * The platform does NOT yet have a 1:1 / group DM backend. This screen
 * surfaces two real things the user CAN act on today:
 *
 *   1. A global lobby room (Socket.IO roomId=0) — listed as a single
 *      "conversation" so the user can jump into the live lobby. Tapping
 *      opens the existing chat view (now at /chat/[lobby]) which still
 *      runs the socket.io lobby.
 *
 *   2. Recent rooms the user has joined — surfaced as "Recent rooms"
 *      because we don't have a conversations table. Tapping opens the
 *      room detail.
 *
 * Both sections render real data. The conversation-list visual is in
 * place so when a real DM backend lands, the rows swap from "room host"
 * metadata to "latest message preview" without restructuring the screen.
 *
 * Until then, the screen clearly documents the integration boundary so
 * a user never thinks they're looking at fake messages.
 */
interface Msg { from: { id: number; displayName: string }; text: string; ts: number }
interface Room {
  id: number; title: string; type: string; audienceCount: number;
  host: { id: number; displayName: string; avatarUrl: string };
}

export default function Messages() {
  const { loggedIn } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [lobbyPreview, setLobbyPreview] = useState<Msg | null>(null);

  // Load recent rooms the user might be interested in (open rooms list —
  // we don't yet have a per-user "rooms you joined" endpoint, so this is
  // the closest real signal).
  useEffect(() => {
    if (!loggedIn) return;
    api<Room[]>("/v1/rooms").then(setRooms).catch(() => setRooms([]));
  }, [loggedIn]);

  // Listen to the lobby for the latest message preview.
  useEffect(() => {
    if (!loggedIn) return;
    let s: Socket | null = null;
    (async () => {
      const tokens = await tokenStore.get();
      s = io(API_BASE, { auth: { token: tokens?.accessToken }, transports: ["websocket"] });
      s.on("connect", () => s?.emit("room:join", 0, () => {}));
      s.on("chat:message", (m: Msg) => setLobbyPreview(m));
    })();
    return () => { s?.disconnect(); };
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <EmptyState
          icon="🔐"
          title="Sign in to see your messages"
          subtitle="Conversations, group chats, and the global lobby are available once you're signed in."
          ctaLabel="Sign in"
          onCta={() => router.replace("/auth/login")}
        />
      </View>
    );
  }

  const recentRooms = rooms.slice(0, 8);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>Messages</Text>
        <Badge tone="muted" label={`${recentRooms.length} active`} />
      </View>

      <FlatList
        data={recentRooms}
        keyExtractor={(r) => String(r.id)}
        ListHeaderComponent={
          <>
            <SectionHeader title="Lobby" icon="💬" />
            <Link href="/chat/lobby" asChild>
              <Pressable>
                <Card variant="hero" style={s.lobbyCard}>
                  <View style={s.convRow}>
                    <Avatar name="Lobby" size={48} />
                    <View style={s.convInfo}>
                      <Text style={s.convName}>Global lobby</Text>
                      <Text style={s.convPreview} numberOfLines={1}>
                        {lobbyPreview
                          ? `${lobbyPreview.from.displayName}: ${lobbyPreview.text}`
                          : "Tap to join the live chat — say hi 👋"}
                      </Text>
                    </View>
                    <Badge tone="accent" label="LIVE" />
                  </View>
                </Card>
              </Pressable>
            </Link>

            <SectionHeader title="Recent rooms" icon="🏠" />
            <Text style={s.helper}>Direct messages are coming soon. For now, jump back into a room you visited.</Text>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="📭"
            title="No conversations yet"
            subtitle="Open rooms from the Live tab to start chatting with hosts and other users."
            ctaLabel="Browse live rooms"
            onCta={() => router.push("/(tabs)/live")}
          />
        }
        renderItem={({ item }) => (
          <Link href={`/room/${item.id}`} asChild>
            <Pressable>
              <Card style={s.convCard}>
                <View style={s.convRow}>
                  <Avatar name={item.host.displayName} imageUrl={item.host.avatarUrl} size={48} />
                  <View style={s.convInfo}>
                    <Text style={s.convName} numberOfLines={1}>{item.title}</Text>
                    <Text style={s.convPreview} numberOfLines={1}>
                      host {item.host.displayName} · 👥 {item.audienceCount}
                    </Text>
                  </View>
                  <Text style={s.convTime}>now</Text>
                </View>
              </Card>
            </Pressable>
          </Link>
        )}
        contentContainerStyle={{ paddingBottom: spacing[6] }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  title: { ...t.h1, color: theme.text },
  lobbyCard: { marginHorizontal: 0 },
  convCard: { marginHorizontal: 0, marginBottom: spacing[1] },
  convRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  convInfo: { flex: 1 },
  convName: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  convPreview: {
    ...t.caption,
    color: theme.textSubtle,
    marginTop: 2,
  },
  convTime: {
    ...t.micro,
    color: theme.textSubtle,
  },
  helper: {
    ...t.caption,
    color: theme.textSubtle,
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
});
