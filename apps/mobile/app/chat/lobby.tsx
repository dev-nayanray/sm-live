import { StyleSheet, Text, View, FlatList, TextInput, Pressable } from "react-native";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { tokenStore } from "../../src/api/client";
import { API_BASE } from "../../src/api/env";
import { useAuth } from "../../src/state/AppProviders";
import { EmptyState, theme, t, spacing, radius, controlHeights } from "../../src/components";

/**
 * SM Live — Global chat lobby (Prompt 13).
 *
 * Moved out of the tab bar to `app/chat/lobby.tsx` so the new Messages tab
 * can host the conversation list. The lobby is reachable from the
 * Messages screen and from the home shortcuts.
 *
 * This is the only group-chat surface in the platform today. The Socket.IO
 * protocol (chat:message / chat:send / room:join) is preserved — when a
 * real DM backend lands, this screen can stay as-is for the lobby and
 * a per-thread screen can mirror its structure.
 */
interface Msg { from: { id: number; displayName: string }; text: string; ts: number }

export default function ChatLobby() {
  const { user, loggedIn } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    let s: Socket | null = null;
    (async () => {
      const tokens = await tokenStore.get();
      s = io(API_BASE, { auth: { token: tokens?.accessToken }, transports: ["websocket"] });
      s.on("connect", () => s?.emit("room:join", 0, () => {}));
      s.on("chat:message", (m: Msg) => setMsgs((prev) => [...prev.slice(-100), m]));
      setSocket(s);
    })();
    return () => { s?.disconnect(); };
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <View style={s.center}>
        <EmptyState icon="🔐" title="Sign in to chat" subtitle="The lobby is available to signed-in users only." />
      </View>
    );
  }

  const send = () => {
    if (!text.trim()) return;
    socket?.emit("chat:send", { roomId: 0, text: text.trim() });
    setText("");
  };

  return (
    <View style={s.root}>
      <Text style={s.header}>💬 Global lobby</Text>
      <FlatList
        data={msgs} keyExtractor={(_, i) => String(i)} style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing[4] }}
        ListEmptyComponent={<EmptyState icon="👋" title="No messages yet" subtitle="Say hi to start the conversation." />}
        renderItem={({ item }) => (
          <View style={item.from.id === user?.id ? s.mine : s.theirs}>
            <Text style={s.author}>{item.from.displayName}</Text>
            <Text style={s.text}>{item.text}</Text>
          </View>
        )}
      />
      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="message…"
          placeholderTextColor={theme.textSubtle}
          onSubmitEditing={send}
        />
        <Pressable style={s.send} onPress={send}><Text style={s.sendText}>send</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  header: { ...t.h2, color: theme.text, padding: spacing[4] },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: theme.primary,
    borderRadius: radius.md,
    padding: spacing[2],
    marginBottom: spacing[2],
    maxWidth: "80%",
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: theme.surface,
    borderRadius: radius.md,
    padding: spacing[2],
    marginBottom: spacing[2],
    maxWidth: "80%",
  },
  author: { ...t.micro, color: theme.textMuted, marginBottom: 2 },
  text: { ...t.body, color: theme.text },
  inputRow: {
    flexDirection: "row",
    padding: spacing[3],
    gap: spacing[2],
    borderTopColor: theme.border,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: controlHeights.input,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    ...t.body,
  },
  send: {
    backgroundColor: theme.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing[5],
    justifyContent: "center",
  },
  sendText: { color: theme.textInverse, ...t.body, fontWeight: "700" },
});
