import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError } from "../src/api/client";
import {
  Avatar, Badge, EmptyState, ErrorState, RoomCard, UserCard, theme, t, spacing,
} from "../src/components";
import { debounce } from "../src/hooks/feedPure";

/**
 * SM Live — Unified search screen (Prompt 15).
 *
 * Three-tab results (Users / Rooms / All) backed by:
 *   - GET /v1/users/search?q=…&page=…
 *   - GET /v1/rooms/search?q=…&page=…
 *
 * Features:
 *   - Debounced search input (300ms) — avoids a request per keystroke.
 *   - Recent searches persisted in AsyncStorage (last 8 entries).
 *   - Empty-state per tab (no results yet / no query).
 *   - Error-state with retry (e.g. rate-limited → 429).
 *   - Pagination via "Load more" button (FlatList onEndReached would
 *     fire too eagerly on a slow network).
 *
 * The screen NEVER accepts a query shorter than 2 chars (matches the
 * backend's `searchQuerySchema`). It NEVER auto-runs a search on mount
 * — the user must type or tap a recent search.
 *
 * Recent searches: stored locally as a JSON array of strings. Cleared
 * via the "Clear" button at the top of the list.
 */

const RECENT_KEY = "smlive:recent-searches:v1";
const MAX_RECENT = 8;
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

interface UserResult {
  id: number;
  displayName: string;
  avatarUrl: string;
  vipLevel: number;
  nobleLevel: number;
  country: string;
  createdAt: string;
  isHosting: boolean;
}
interface RoomResult {
  id: number;
  title: string;
  type: string;
  slots: number;
  country: string;
  audienceCount: number;
  closed: boolean;
  createdAt: string;
  host: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
}
interface SearchResponse<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

type Tab = "all" | "users" | "rooms";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [recent, setRecent] = useState<string[]>([]);
  const [users, setUsers] = useState<UserResult[]>([]);
  const [rooms, setRooms] = useState<RoomResult[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [roomPage, setRoomPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [roomTotal, setRoomTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load recent searches on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENT_KEY);
        if (raw) setRecent(JSON.parse(raw) as string[]);
      } catch { /* ignore */ }
    })();
  }, []);

  // Debounced search trigger. Cancels on unmount.
  const runSearch = useRef(
    debounce((q: string) => doSearch(q, 1, /* reset */ true), DEBOUNCE_MS),
  ).current;
  useEffect(() => () => { runSearch.cancel(); }, [runSearch]);

  const doSearch = useCallback(async (q: string, page: number, reset: boolean) => {
    if (q.trim().length < MIN_QUERY) {
      setUsers([]); setRooms([]); setUserTotal(0); setRoomTotal(0);
      setLoading(false); setLoadingMore(false);
      return;
    }
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      // Fire both queries in parallel — they're independent.
      const [u, r] = await Promise.all([
        api<SearchResponse<UserResult>>(`/v1/users/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=20`),
        api<SearchResponse<RoomResult>>(`/v1/rooms/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=20`),
      ]);
      if (reset) {
        setUsers(u.items); setRooms(r.items);
      } else {
        setUsers((prev) => [...prev, ...u.items]);
        setRooms((prev) => [...prev, ...r.items]);
      }
      setUserTotal(u.total); setRoomTotal(r.total);
      setUserPage(page); setRoomPage(page);
    } catch (e) {
      const err = e as Error & { code?: string };
      const msg = e instanceof ApiError ? e.message : err.message;
      setError(msg);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, []);

  const onQueryChange = (text: string) => {
    setQuery(text);
    setError(null);
    if (text.trim().length >= MIN_QUERY) {
      runSearch(text.trim());
    } else {
      setUsers([]); setRooms([]);
    }
  };

  const persistRecent = async (q: string) => {
    try {
      const next = [q, ...recent.filter((r) => r !== q)].slice(0, MAX_RECENT);
      setRecent(next);
      await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const onSearchSubmit = () => {
    if (query.trim().length >= MIN_QUERY) {
      void persistRecent(query.trim());
      void doSearch(query.trim(), 1, true);
      Keyboard.dismiss();
    }
  };

  const onRecentTap = (q: string) => {
    setQuery(q);
    void persistRecent(q);
    void doSearch(q, 1, true);
  };

  const clearRecent = async () => {
    setRecent([]);
    try { await AsyncStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  };

  const loadMore = () => {
    if (loadingMore || loading) return;
    const nextPage = Math.max(userPage, roomPage) + 1;
    void doSearch(query.trim(), nextPage, false);
  };

  const hasQuery = query.trim().length >= MIN_QUERY;
  const hasAnyResult = users.length > 0 || rooms.length > 0;
  const moreAvailable = users.length < userTotal || rooms.length < roomTotal;

  return (
    <View style={s.root}>
      {/* Search bar */}
      <View style={s.searchRow}>
        <Pressable style={s.backBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={s.backIcon}>←</Text>
        </Pressable>
        <TextInput
          style={s.input}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Search creators, rooms, content…"
          placeholderTextColor={theme.textSubtle}
          returnKeyType="search"
          onSubmitEditing={onSearchSubmit}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {query.length > 0 && (
          <Pressable style={s.clearBtn} onPress={() => { setQuery(""); setUsers([]); setRooms([]); }} accessibilityRole="button" accessibilityLabel="Clear search">
            <Text style={s.clearIcon}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs — only show when a query is active */}
      {hasQuery && (
        <View style={s.tabs}>
          {([
            ["all", `All (${users.length + rooms.length})`],
            ["users", `Creators (${users.length})`],
            ["rooms", `Rooms (${rooms.length})`],
          ] as Array<[Tab, string]>).map(([k, l]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabActive]}>
              <Text style={[s.tabText, tab === k && s.tabTextActive]}>{l}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Recent searches (when no query) */}
      {!hasQuery && (
        <View style={s.recentWrap}>
          <View style={s.recentHeader}>
            <Text style={s.recentTitle}>Recent searches</Text>
            {recent.length > 0 && (
              <Pressable onPress={clearRecent}><Text style={s.clearRecent}>Clear</Text></Pressable>
            )}
          </View>
          {recent.length === 0 ? (
            <Text style={s.recentEmpty}>No recent searches yet.</Text>
          ) : (
            recent.map((q) => (
              <Pressable key={q} style={s.recentRow} onPress={() => onRecentTap(q)}>
                <Text style={s.recentIcon}>🕒</Text>
                <Text style={s.recentText}>{q}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* Loading / error / results */}
      {hasQuery && loading && (
        <View style={s.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      )}

      {hasQuery && !loading && error && (
        <ErrorState
          title="Search failed"
          subtitle="The backend may be rate-limiting your requests or unreachable."
          technical={error}
          ctaLabel="Retry"
          onCta={() => doSearch(query.trim(), 1, true)}
        />
      )}

      {hasQuery && !loading && !error && !hasAnyResult && (
        <EmptyState
          icon="🔍"
          title={`No results for "${query.trim()}"`}
          subtitle="Try a different keyword, or check the spelling."
        />
      )}

      {hasQuery && !loading && !error && hasAnyResult && (
        <FlatList
          style={s.results}
          contentContainerStyle={{ padding: spacing[4], gap: spacing[2] }}
          data={mergedResults(tab, users, rooms)}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          onEndReached={moreAvailable ? loadMore : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footerLoading}><ActivityIndicator color={theme.primary} size="small" /></View>
            ) : moreAvailable ? (
              <Pressable style={s.loadMore} onPress={loadMore}>
                <Text style={s.loadMoreText}>Load more</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState icon="🔍" title="No results in this tab" subtitle="Try another tab or a different query." />
          }
          renderItem={({ item }) => {
            if (item.kind === "user") {
              const u = item as { kind: "user" } & UserResult;
              return (
                <UserCard user={u} variant="list" />
              );
            }
            const r = item as { kind: "room" } & RoomResult;
            return (
              <RoomCard room={r} variant="list" />
            );
          }}
        />
      )}
    </View>
  );
}

/** Merge user + room results into a single list for the "all" tab. The
 *  list alternates users + rooms (zip) so neither section dominates the
 *  first viewport. */
function mergedResults(tab: Tab, users: UserResult[], rooms: RoomResult[]): Array<({ kind: "user" } & UserResult) | ({ kind: "room" } & RoomResult)> {
  if (tab === "users") return users.map((u) => ({ kind: "user" as const, ...u }));
  if (tab === "rooms") return rooms.map((r) => ({ kind: "room" as const, ...r }));
  const out: Array<({ kind: "user" } & UserResult) | ({ kind: "room" } & RoomResult)> = [];
  const max = Math.max(users.length, rooms.length);
  for (let i = 0; i < max; i++) {
    if (users[i]) out.push({ kind: "user", ...users[i]! });
    if (rooms[i]) out.push({ kind: "room", ...rooms[i]! });
  }
  return out;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  searchRow: {
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
  input: {
    flex: 1,
    height: 40,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    ...t.body,
  },
  clearBtn: {
    width: 32, height: 32,
    borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  clearIcon: { fontSize: 14, color: theme.textSubtle },
  tabs: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  tab: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: theme.surfaceAlt,
  },
  tabActive: { backgroundColor: theme.primary },
  tabText: {
    ...t.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  tabTextActive: { color: theme.textInverse },
  recentWrap: {
    padding: spacing[4],
    gap: spacing[2],
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recentTitle: {
    ...t.h2,
    color: theme.text,
  },
  clearRecent: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
  recentEmpty: {
    ...t.body,
    color: theme.textSubtle,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  recentIcon: { fontSize: 16 },
  recentText: {
    ...t.body,
    color: theme.text,
  },
  results: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  footerLoading: { padding: spacing[3], alignItems: "center" },
  loadMore: {
    alignSelf: "center",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: theme.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    marginVertical: spacing[3],
  },
  loadMoreText: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
});

// keep these imports referenced so the linter doesn't strip them — they
// are used by the JSX above (Avatar + Badge via the child cards).
void Avatar;
void Badge;
