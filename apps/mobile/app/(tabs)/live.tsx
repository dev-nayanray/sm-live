import { Link } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";

interface Room {
  id: number; title: string; type: string; slots: number; country: string; audienceCount: number;
  host: { displayName: string };
}

export default function Live() {
  const { user } = useAuth();
  const [type, setType] = useState<"all" | "live" | "voice" | "party">("all");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = type === "all" ? "" : `?type=${type}`;
      setRooms(await api<Room[]>(`/v1/rooms${q}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [type]);

  useEffect(() => { void load(); }, [load]);

  const createRoom = async (roomType: "live" | "voice" | "party") => {
    const slots = roomType === "party" ? 9 : roomType === "live" ? 3 : 10;
    const res = await api<{ id: number }>("/v1/rooms", { method: "POST", json: { title: title.trim() || `${user?.displayName ?? "My"} ${roomType} room`, type: roomType, slots, country: "BD" } });
    setCreating(false);
    // router push happens via Link-style navigation by caller
    return res.id;
  };

  return (
    <View style={s.root}>
      <View style={s.filterRow}>
        {(["all", "live", "voice", "party"] as const).map((t) => (
          <Pressable key={t} onPress={() => setType(t)} style={[s.chip, type === t && s.chipActive]}>
            <Text style={[s.chipText, type === t && s.chipTextActive]}>{t === "all" ? "all" : t === "live" ? "🔴 live" : t === "voice" ? "🎙️ voice" : "🎉 party"}</Text>
          </Pressable>
        ))}
        <Pressable style={s.newBtn} onPress={() => setCreating(true)}><Text style={s.newBtnText}>+ start</Text></Pressable>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {creating && (
        <View style={s.createCard}>
          <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="room title" placeholderTextColor="#475569" />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["live", "voice", "party"] as const).map((t) => (
              <Pressable key={t} style={s.createBtn} onPress={() => void createRoom(t)}>
                <Text style={s.createBtnText}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <FlatList
        data={rooms} keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={s.empty}>no rooms — tap “+ start” to open one</Text>}
        renderItem={({ item }) => (
          <Link href={`/room/${item.id}`} asChild>
            <Pressable style={s.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.cardTitle}>{item.title}</Text>
                <Text style={s.badge}>{item.type}</Text>
              </View>
              <Text style={s.cardMeta}>host {item.host.displayName} · 👥 {item.audienceCount}/{item.slots} · 🌍 {item.country}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  filterRow: { flexDirection: "row", gap: 8, padding: 16, alignItems: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#1e293b" },
  chipActive: { backgroundColor: "#7c3aed" },
  chipText: { color: "#94a3b8", fontWeight: "600", textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  newBtn: { marginLeft: "auto", backgroundColor: "#f43f5e", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  newBtnText: { color: "#fff", fontWeight: "700" },
  createCard: { backgroundColor: "#1e293b", marginHorizontal: 16, borderRadius: 14, padding: 12, marginBottom: 8 },
  input: { backgroundColor: "#0f172a", color: "#f8fafc", borderRadius: 10, padding: 12, marginBottom: 10 },
  createBtn: { flex: 1, backgroundColor: "#7c3aed", padding: 10, borderRadius: 10, alignItems: "center" },
  createBtnText: { color: "#fff", fontWeight: "700", textTransform: "capitalize" },
  card: { backgroundColor: "#1e293b", borderRadius: 14, padding: 16, marginBottom: 10 },
  cardTitle: { color: "#f8fafc", fontWeight: "700", flex: 1 },
  badge: { color: "#a78bfa", fontSize: 12, textTransform: "uppercase", fontWeight: "700" },
  cardMeta: { color: "#64748b", fontSize: 12, marginTop: 6 },
  empty: { color: "#475569", textAlign: "center", marginTop: 40 },
  error: { color: "#fb7185", paddingHorizontal: 16, paddingVertical: 8 },
});
