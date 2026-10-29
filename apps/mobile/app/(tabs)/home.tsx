import { Link } from "expo-router";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../src/api/client";
import { useAppConfig } from "../../src/state/AppProviders";

interface Room {
  id: number; title: string; type: string; country: string; audienceCount: number;
  host: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
}
interface RankRow { rank: number; points: number; user: { displayName: string; vipLevel: number } }
interface Feed { id: number; title?: string; text?: string; authorId: number; likes: number }

export default function Home() {
  const { config, flag } = useAppConfig();
  const [country, setCountry] = useState("ALL");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [videos, setVideos] = useState<Feed[]>([]);
  const [moments, setMoments] = useState<Feed[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = country === "ALL" ? "" : `&country=${country}`;
      const [r, k, v, m] = await Promise.all([
        api<Room[]>(`/v1/rooms?${q}`),
        api<RankRow[]>("/v1/gifts/ranking?period=weekly").catch(() => []),
        api<{ items: Feed[] }>("/v1/content/short-videos?page=1&pageSize=10").catch(() => ({ items: [] as Feed[] })),
        api<{ items: Feed[] }>("/v1/content/moments?page=1&pageSize=10").catch(() => ({ items: [] as Feed[] })),
      ]);
      setRooms(r);
      setRanking(k);
      setVideos(v.items);
      setMoments(m.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [country]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <View style={s.center}><Text style={s.errorText}>couldn't load feed{"\n"}{error}</Text>
        <Pressable style={s.retry} onPress={() => void load()}><Text style={s.retryText}>retry</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#a78bfa" />}>
      {/* country filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>
        {["ALL", "BD", "IN", "PK", "NG"].map((c) => (
          <Pressable key={c} onPress={() => setCountry(c)} style={[s.chip, country === c && s.chipActive]}>
            <Text style={[s.chipText, country === c && s.chipTextActive]}>{c === "ALL" ? "🌍 All" : c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={s.section}>🔴 Live & Voice rooms</Text>
      {rooms.length === 0 ? <Text style={s.empty}>no rooms yet — start one from the Live tab</Text> : (
        <FlatList
          horizontal data={rooms} keyExtractor={(r) => String(r.id)} showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Link href={`/room/${item.id}`} asChild>
              <Pressable style={s.roomCard}>
                <Text style={s.roomType}>{item.type === "live" ? "🔴" : item.type === "party" ? "🎉" : "🎙️"} {item.type}</Text>
                <Text style={s.roomTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={s.roomMeta}>👤 {item.host.displayName} · 👥 {item.audienceCount}</Text>
              </Pressable>
            </Link>
          )}
        />
      )}

      {flag("short_video.enabled") && (
        <>
          <Text style={s.section}>🎬 Short videos</Text>
          {videos.length === 0 ? <Text style={s.empty}>no videos yet</Text> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {videos.map((v) => (
                <View key={v.id} style={s.videoCard}><Text numberOfLines={2} style={s.videoTitle}>{v.title}</Text><Text style={s.likes}>♥ {v.likes}</Text></View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      <Text style={s.section}>🏆 Weekly gifting ranking</Text>
      {ranking.length === 0 ? <Text style={s.empty}>no ranking data yet</Text> : (
        ranking.slice(0, 10).map((r) => (
          <View key={r.rank} style={s.rankRow}>
            <Text style={s.rankBadge}>{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : `#${r.rank}`}</Text>
            <Text style={s.rankName}>{r.user.displayName}{r.user.vipLevel > 0 ? `  VIP${r.user.vipLevel}` : ""}</Text>
            <Text style={s.rankPoints}>{r.points.toLocaleString()} pts</Text>
          </View>
        ))
      )}

      <Text style={s.section}>✨ Moments</Text>
      {moments.length === 0 ? <Text style={s.empty}>no moments yet</Text> : (
        moments.slice(0, 6).map((m) => (
          <View key={m.id} style={s.momentCard}><Text style={s.momentText}>{m.text}</Text><Text style={s.likes}>♥ {m.likes}</Text></View>
        ))
      )}

      <Text style={s.footer}>market: {config.market} · {config.games.length} games · {config.gifts.length} gifts</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", padding: 32 },
  errorText: { color: "#fb7185", textAlign: "center", marginBottom: 16 },
  retry: { backgroundColor: "#7c3aed", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#fff", fontWeight: "700" },
  chips: { paddingHorizontal: 16, paddingTop: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: "#1e293b", marginRight: 8 },
  chipActive: { backgroundColor: "#7c3aed" },
  chipText: { color: "#94a3b8", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  section: { color: "#f8fafc", fontWeight: "700", fontSize: 16, marginTop: 20, marginBottom: 10, paddingHorizontal: 16 },
  empty: { color: "#475569", paddingHorizontal: 16, marginBottom: 8 },
  roomCard: { backgroundColor: "#1e293b", borderRadius: 14, padding: 14, width: 180, marginRight: 10, marginLeft: 16 },
  roomType: { color: "#94a3b8", fontSize: 12, marginBottom: 6 },
  roomTitle: { color: "#f8fafc", fontWeight: "700", marginBottom: 8 },
  roomMeta: { color: "#64748b", fontSize: 12 },
  videoCard: { backgroundColor: "#1e293b", borderRadius: 14, padding: 14, width: 140, height: 200, marginRight: 10, marginLeft: 16, justifyContent: "space-between" },
  videoTitle: { color: "#f8fafc" },
  likes: { color: "#fb7185", fontSize: 12 },
  rankRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  rankBadge: { width: 44, fontSize: 16 },
  rankName: { flex: 1, color: "#e2e8f0" },
  rankPoints: { color: "#a78bfa", fontWeight: "700" },
  momentCard: { backgroundColor: "#1e293b", borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 8 },
  momentText: { color: "#e2e8f0", marginBottom: 6 },
  footer: { color: "#475569", textAlign: "center", marginVertical: 24, fontSize: 12 },
});
