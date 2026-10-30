import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import {
  Avatar, Badge, EmptyState, Loading,
  theme, t, spacing, radius,
} from "../../src/components";
import { debounce } from "../../src/hooks/feedPure";

/**
 * SM Live — Start a new chat (Prompt 19).
 *
 * Search for a user by display name, then tap to start a 1:1 conversation.
 * POST /v1/messages/conversations with participantIds=[userId] creates the
 * conversation (or returns the existing one if it already exists). Then
 * routes to /chat/[conversationId].
 */
interface UserResult {
  id: number;
  displayName: string;
  avatarUrl: string;
  vipLevel: number;
  nobleLevel: number;
  country: string;
}

export default function NewChatScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null); // userId being started
  const [error, setError] = useState<string | null>(null);

  const search = useRef(debounce(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setError(null);
    try {
      const data = await api<{ items: UserResult[] }>(`/v1/users/search?q=${encodeURIComponent(q)}&page=1&pageSize=20`);
      setResults(data.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, 300)).current;

  useEffect(() => () => { search.cancel(); }, [search]);

  const onQueryChange = (text: string) => {
    setQuery(text);
    setLoading(true);
    search(text.trim());
  };

  const startConversation = async (userId: number) => {
    if (busy !== null) return;
    setBusy(userId);
    setError(null);
    try {
      const res = await api<{ id: number }>("/v1/messages/conversations", {
        method: "POST",
        json: { participantIds: [userId], type: "private" },
      });
      router.replace(`/chat/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <Text style={s.title}>New chat</Text>
      </View>
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search by name…"
          placeholderTextColor={theme.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <Loading label="Searching…" />
      ) : error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : results.length === 0 && query.trim().length >= 2 ? (
        <EmptyState icon="🔍" title="No users found" subtitle="Try a different name." />
      ) : results.length === 0 ? (
        <EmptyState icon="💬" title="Search for someone to chat with" subtitle="Type at least 2 characters to search." />
      ) : (
        <ScrollView contentContainerStyle={{ paddingVertical: spacing[2] }}>
          {results.map((u) => (
            <Pressable
              key={u.id}
              style={({ pressed }) => [s.userRow, pressed && { opacity: 0.7 }]}
              onPress={() => startConversation(u.id)}
              disabled={busy !== null}
            >
              <Avatar name={u.displayName} imageUrl={u.avatarUrl} size={44} vipLevel={u.vipLevel} />
              <View style={s.userInfo}>
                <Text style={s.userName} numberOfLines={1}>{u.displayName}</Text>
                <View style={s.userBadges}>
                  {u.vipLevel > 0 && <Badge tone="vip" label={`VIP${u.vipLevel}`} />}
                  <Badge tone="muted" label={u.country} icon="🌍" />
                </View>
              </View>
              {busy === u.id ? (
                <Text style={s.startingText}>…</Text>
              ) : (
                <Text style={s.startIcon}>💬</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  backIcon: { fontSize: 18, color: theme.text },
  title: { ...t.h2, color: theme.text },
  searchRow: {
    padding: spacing[3],
  },
  searchInput: {
    height: 44,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: spacing[3],
    ...t.body,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  userInfo: { flex: 1, gap: 2 },
  userName: { ...t.body, color: theme.text, fontWeight: "600" },
  userBadges: { flexDirection: "row", gap: spacing[1] },
  startIcon: { fontSize: 20 },
  startingText: { ...t.caption, color: theme.textSubtle },
  errorBox: {
    backgroundColor: "rgba(251, 113, 133, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginHorizontal: spacing[4],
    borderRadius: 4,
  },
  errorText: { ...t.caption, color: theme.danger },
});
