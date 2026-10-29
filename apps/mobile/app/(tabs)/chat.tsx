import { StyleSheet, Text, View, FlatList, TextInput, Pressable } from "react-native";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "../../src/api/client";
import { tokenStore } from "../../src/api/client";
import { API_BASE } from "../../src/api/env";
import { useAuth } from "../../src/state/AppProviders";

/**
 * Group chat / inbox stub: a global lobby room over Socket.IO.
 * 1:1 and group threads reuse the same chat:message event scoped by room id.
 */
interface Msg { from: { id: number; displayName: string }; text: string; ts: number }

export default function Chat() {
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

  if (!loggedIn) return <View style={s.center}><Text style={s.hint}>sign in to chat</Text></View>;

  const send = () => {
    if (!text.trim()) return;
    socket?.emit("chat:send", { roomId: 0, text: text.trim() });
    setText("");
  };

  return (
    <View style={s.root}>
      <Text style={s.header}>💬 Lobby</Text>
      <FlatList
        data={msgs} keyExtractor={(_, i) => String(i)} style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={s.hint}>no messages yet — say hi 👋</Text>}
        renderItem={({ item }) => (
          <View style={item.from.id === user?.id ? s.mine : s.theirs}>
            <Text style={s.author}>{item.from.displayName}</Text>
            <Text style={s.text}>{item.text}</Text>
          </View>
        )}
      />
      <View style={s.inputRow}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="message…" placeholderTextColor="#475569" onSubmitEditing={send} />
        <Pressable style={s.send} onPress={send}><Text style={s.sendText}>send</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  hint: { color: "#475569" },
  header: { color: "#f8fafc", fontWeight: "700", padding: 16, fontSize: 16 },
  mine: { alignSelf: "flex-end", backgroundColor: "#7c3aed", borderRadius: 14, padding: 10, marginBottom: 8, maxWidth: "80%" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#1e293b", borderRadius: 14, padding: 10, marginBottom: 8, maxWidth: "80%" },
  author: { color: "#cbd5e1", fontSize: 11, marginBottom: 2 },
  text: { color: "#f8fafc" },
  inputRow: { flexDirection: "row", padding: 12, gap: 8, borderTopColor: "#1e293b", borderTopWidth: 1 },
  input: { flex: 1, backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 12, paddingHorizontal: 14 },
  send: { backgroundColor: "#7c3aed", borderRadius: 12, paddingHorizontal: 18, justifyContent: "center" },
  sendText: { color: "#fff", fontWeight: "700" },
});
