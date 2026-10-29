import { useLocalSearchParams, router } from "expo-router";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LiveKitRoom } from "@livekit/react-native";
import { io, type Socket } from "socket.io-client";
import { api, tokenStore } from "../../src/api/client";
import { API_BASE, LIVEKIT_URL } from "../../src/api/env";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";

interface RoomInfo {
  id: number; title: string; type: string; slots: number; country: string;
  host: { id: number; displayName: string; vipLevel: number; nobleLevel: number };
  audienceCount: number;
  participants: { userId: number; displayName: string; slotIndex: number | null; role: string; muted: boolean }[];
}
interface Msg { from: { id: number; displayName: string; vipLevel?: number; nobleLevel?: number }; text: string; ts: number }

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roomId = Number(id);
  const { user, loggedIn } = useAuth();
  const { config, flag } = useAppConfig();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [token, setToken] = useState<{ token: string; canPublish: boolean } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      await api(`/v1/rooms/${roomId}/join`, { method: "POST" });
      const [info, tok] = await Promise.all([
        api<RoomInfo>(`/v1/rooms/${roomId}`),
        api<{ token: string; canPublish: boolean; url: string }>(`/v1/rooms/${roomId}/token`, { method: "POST" }),
      ]);
      setRoom(info);
      setToken({ token: tok.token, canPublish: tok.canPublish });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!loggedIn) return;
    let s: Socket | null = null;
    (async () => {
      const tokens = await tokenStore.get();
      s = io(API_BASE, { auth: { token: tokens?.accessToken }, transports: ["websocket"] });
      s.on("connect", () => {
        s?.emit("room:join", roomId, () => {});
        s?.emit("chat:send", { roomId, text: "joined the room 👋" });
      });
      s.on("chat:message", (m: Msg) => m.from.id !== user?.id && setMsgs((p) => [...p.slice(-80), m]));
      s.on("gift:broadcast", (g: { name: string; from: { displayName: string }; quantity: number; animation: string }) => {
        setFlash(`🎁 ${g.from.displayName} sent ${g.quantity}× ${g.name}${g.animation === "full" ? " ✨FULL-SCREEN✨" : ""}`);
        setTimeout(() => setFlash(null), 4000);
      });
      s.on("slot:assigned", () => void load());
      s.on("room:kicked", (k: { userId: number }) => {
        if (k.userId === user?.id) router.back();
      });
      setSocket(s);
    })();
    return () => { s?.disconnect(); };
  }, [loggedIn, roomId, user?.id, load]);

  const send = () => {
    if (!text.trim()) return;
    setMsgs((p) => [...p, { from: { id: user?.id ?? 0, displayName: user?.displayName ?? "me" }, text, ts: Date.now() }]);
    socket?.emit("chat:send", { roomId, text: text.trim() });
    setText("");
  };

  const sendGift = async (giftId: number) => {
    await api("/v1/gifts/send", { method: "POST", json: { giftId, roomId, quantity: 1 } });
    setGiftOpen(false);
  };

  const requestSlot = async () => {
    await api(`/v1/rooms/${roomId}/slot-request`, { method: "POST" });
    setFlash("⏳ slot requested — waiting for host approval");
    setTimeout(() => setFlash(null), 3000);
  };

  const mySlot = useMemo(
    () => room?.participants.find((p) => p.userId === user?.id) ?? null,
    [room, user?.id]
  );

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.err}>{error}</Text>
        <Pressable onPress={router.back}><Text style={s.link}>← back</Text></Pressable>
      </View>
    );
  }
  if (!room || !token) return <View style={s.center}><Text style={s.muted}>joining…</Text></View>;

  const isParty = room.type === "party";

  return (
    <View style={s.root}>
      {/* PK battle stub */}
      {flag("pk_battle.enabled") && room.type === "live" && (
        <View style={s.pk}><Text style={s.pkText}>⚔️ PK battle (stub)</Text></View>
      )}

      {/* stage */}
      <View style={s.stage}>
        <Text style={s.title}>{room.title}</Text>
        <Text style={s.meta}>
          {room.type === "live" ? "🔴" : isParty ? "🎉" : "🎙️"} {room.type} · 👥 {room.audienceCount}/{room.slots} · host {room.host.displayName}
          {room.host.vipLevel > 0 ? ` · VIP${room.host.vipLevel}` : ""}
          {room.host.nobleLevel > 0 ? ` 👑${room.host.nobleLevel}` : ""}
        </Text>

        {/* LiveKit audio/video stage. Publish only when holding a slot. */}
        <View style={s.livekitBox}>
          <LiveKitRoom
            serverUrl={LIVEKIT_URL}
            token={token.token}
            connect={true}
          >
            <View style={s.stageInner}>
              <Text style={s.livekitHint}>
                {token.canPublish
                  ? `mic active as ${mySlot?.role ?? "host"} (slot ${(mySlot?.slotIndex ?? 0) + 1})`
                  : "watching — request a mic slot to publish"}
              </Text>
            </View>
          </LiveKitRoom>
        </View>

        {/* slot grid for voice/party */}
        {(room.type === "voice" || isParty) && (
          <View style={s.slots}>
            {Array.from({ length: Math.min(room.slots, 9) }).map((_, i) => {
              const p = room.participants.find((x) => x.slotIndex === i);
              return (
                <View key={i} style={[s.slot, p && s.slotTaken]}>
                  <Text style={s.slotText}>{p ? `${p.muted ? "🔇" : "🎤"} ${p.displayName.slice(0, 6)}` : `slot ${i + 1}`}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {flash && <View style={s.flash}><Text style={s.flashText}>{flash}</Text></View>}

      {/* chat */}
      <FlatList
        style={s.chat} data={msgs} keyExtractor={(_, i) => String(i)}
        ListEmptyComponent={<Text style={s.muted}>no messages…</Text>}
        renderItem={({ item }) => (
          <Text style={s.msg}>
            <Text style={[s.msgAuthor, { color: item.from.vipLevel ? "#a78bfa" : "#f43f5e" }]}>
              {item.from.displayName}{item.from.vipLevel ? ` VIP${item.from.vipLevel}` : ""}{item.from.nobleLevel ? " 👑" : ""}:{" "}
            </Text>
            <Text style={s.msgText}>{item.text}</Text>
          </Text>
        )}
      />

      {/* actions */}
      <View style={s.actions}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="say something…" placeholderTextColor="#475569" onSubmitEditing={send} />
        <Pressable style={s.btn} onPress={send}><Text style={s.btnText}>➤</Text></Pressable>
        {flag("gifting.enabled") && (
          <Pressable style={[s.btn, s.giftBtn]} onPress={() => setGiftOpen(true)}><Text style={s.btnText}>🎁</Text></Pressable>
        )}
        {!token.canPublish && (room.type === "voice" || isParty) && (
          <Pressable style={[s.btn, s.micBtn]} onPress={() => void requestSlot()}><Text style={s.btnText}>🎤</Text></Pressable>
        )}
        {token.canPublish && (
          <Pressable style={[s.btn, s.micBtn]} onPress={() => setMicOn((m) => !m)}><Text style={s.btnText}>{micOn ? "🎙️" : "🔇"}</Text></Pressable>
        )}
      </View>

      {/* gift sheet */}
      <Modal visible={giftOpen} animationType="slide" onRequestClose={() => setGiftOpen(false)}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>send a gift 🎁 ({config.gifts.length} available)</Text>
          <ScrollView>
            <View style={s.giftGrid}>
              {config.gifts.map((g) => (
                <Pressable key={g.id} style={s.giftCard} onPress={() => void sendGift(g.id)}>
                  <Text style={s.giftIcon}>🎁</Text>
                  <Text style={s.giftName}>{g.name}</Text>
                  <Text style={s.giftPrice}>{g.price} 🪙</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable style={s.sheetClose} onPress={() => setGiftOpen(false)}><Text style={s.btnText}>close</Text></Pressable>
        </View>
      </Modal>
        </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 24 },
  err: { color: "#fb7185", marginBottom: 12, textAlign: "center" },
  link: { color: "#a78bfa" },
  muted: { color: "#475569" },
  pk: { backgroundColor: "#7f1d1d", padding: 6, alignItems: "center" },
  pkText: { color: "#fecaca", fontWeight: "700", fontSize: 12 },
  stage: { padding: 16 },
  title: { color: "#f8fafc", fontWeight: "800", fontSize: 18 },
  meta: { color: "#64748b", fontSize: 12, marginTop: 4 },
  livekitBox: { height: 160, backgroundColor: "#000", borderRadius: 12, marginTop: 12, overflow: "hidden", justifyContent: "flex-end" },
  stageInner: { flex: 1, justifyContent: "flex-end" },
  livekitHint: { color: "#94a3b8", fontSize: 11, textAlign: "center", padding: 4, backgroundColor: "#000000aa" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  slot: { width: "30%", aspectRatio: 1.4, borderRadius: 10, backgroundColor: "#1e293b", alignItems: "center", justifyContent: "center" },
  slotTaken: { backgroundColor: "#4c1d95" },
  slotText: { color: "#94a3b8", fontSize: 11 },
  flash: { backgroundColor: "#4c1d95", padding: 8, marginHorizontal: 16, borderRadius: 10 },
  flashText: { color: "#e9d5ff", textAlign: "center", fontWeight: "600" },
  chat: { flex: 1, paddingHorizontal: 16 },
  msg: { marginBottom: 6, flexWrap: "wrap" },
  msgAuthor: { fontWeight: "700" },
  msgText: { color: "#e2e8f0" },
  actions: { flexDirection: "row", gap: 8, padding: 12, borderTopColor: "#1e293b", borderTopWidth: 1, alignItems: "center" },
  input: { flex: 1, backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  btn: { backgroundColor: "#7c3aed", width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  giftBtn: { backgroundColor: "#f43f5e" },
  micBtn: { backgroundColor: "#0ea5e9" },
  btnText: { color: "#fff", fontWeight: "700" },
  sheet: { flex: 1, backgroundColor: "#0f172a", paddingTop: 60, padding: 16 },
  sheetTitle: { color: "#f8fafc", fontWeight: "800", fontSize: 18, marginBottom: 16 },
  giftGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  giftCard: { width: "31%", backgroundColor: "#1e293b", borderRadius: 12, padding: 12, alignItems: "center" },
  giftIcon: { fontSize: 26 },
  giftName: { color: "#e2e8f0", fontSize: 12, marginTop: 6, textAlign: "center" },
  giftPrice: { color: "#f59e0b", fontSize: 11, marginTop: 2 },
  sheetClose: { backgroundColor: "#334155", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 12 },
});
