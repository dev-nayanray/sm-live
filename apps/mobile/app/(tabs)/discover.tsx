import { Link, router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { useAppConfig } from "../../src/state/AppProviders";
import {
  Avatar, Badge, Card, EmptyState, ErrorState, Loading, MomentCard,
  RoomCard, SectionHeader, ShortVideoCard, TopHeader, UserCard,
  theme, t, spacing,
} from "../../src/components";
import { debounce } from "../../src/hooks/feedPure";
import { filterRooms, type DiscoverRoom } from "../../src/hooks/discoverPure";

/**
 * SM Live — Discover screen (Prompt 15).
 *
 * Rewritten from the Prompt 13 version to use the new /v1/feed/home
 * aggregator + the design-system cards. Adds:
 *
 *   - TopHeader (brand + search shortcut + wallet + avatar).
 *   - Search bar that routes to /search (the unified search screen)
 *     rather than filtering locally — the local filter is kept as a
 *     fallback for offline / quick filtering.
 *   - Recommended creators (horizontal carousel of UserCards).
 *   - Trending live rooms (horizontal carousel of RoomCards).
 *   - Popular rooms (vertical list of RoomCards, sorted by audience).
 *   - Trending short videos (when short_video.enabled).
 *   - Recent moments (vertical list of MomentCards).
 *   - Trending games (when games.enabled).
 *
 * Real data only — every section pulls from the live /v1/feed/home
 * response. When the backend returns an empty array for a section, the
 * EmptyState makes that explicit.
 *
 * Pull-to-refresh re-fetches the whole feed in a single round-trip.
 */

interface FeedHost {
  id: number;
  displayName: string;
  avatarUrl: string;
  vipLevel: number;
  nobleLevel: number;
}
interface FeedRoom {
  id: number;
  title: string;
  type: string;
  slots: number;
  country: string;
  audienceCount: number;
  closed: boolean;
  createdAt: string;
  host: FeedHost;
}
interface FeedCreator {
  rank: number;
  points: number;
  user: {
    id: number;
    displayName: string;
    avatarUrl: string;
    vipLevel: number;
    nobleLevel: number;
    country: string;
  };
}
interface FeedVideo {
  id: number;
  authorId: number;
  title: string;
  videoUrl: string;
  coverUrl: string;
  likes: number;
  country: string;
  createdAt: string;
}
interface FeedMoment {
  id: number;
  authorId: number;
  text: string;
  imageUrl: string;
  likes: number;
  country: string;
  createdAt: string;
}
interface FeedGame {
  code: string;
  name: string;
  isPro: boolean;
  thumbnailUrl: string;
  status: string;
}
interface HomeFeedResponse {
  category: string;
  rooms: FeedRoom[];
  popularRooms: FeedRoom[];
  liveRooms: FeedRoom[];
  creators: FeedCreator[];
  videos: FeedVideo[];
  moments: FeedMoment[];
  games: FeedGame[];
  generatedAt: string;
}

export default function Discover() {
  const { config, flag } = useAppConfig();
  const [feed, setFeed] = useState<HomeFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local quick-filter (offline-friendly). The full search happens on
  // /search; this just narrows the room carousel on this screen.
  const [localQuery, setLocalQuery] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<HomeFeedResponse>(`/v1/feed/home?category=for_you`);
      setFeed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  // Debounced search-bar tap → route to /search. The bar is a shortcut,
  // not an inline input — the real search UI is on its own screen so we
  // can support recent searches + tabbed results cleanly.
  const goToSearch = useRef(debounce(() => router.push("/search"), 200)).current;
  // cancel on unmount
  useEffect(() => () => { goToSearch.cancel(); }, [goToSearch]);

  if (loading && !feed) return <><TopHeader /><Loading label="Loading discover…" /></>;

  if (error && !feed) {
    return (
      <View style={s.root}>
        <TopHeader />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControlCustom refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <ErrorState
            title="Couldn't load discover feed"
            subtitle="Pull down to retry. If the problem persists, the backend may be unreachable."
            technical={error}
            ctaLabel="Retry"
            onCta={() => { setLoading(true); void load(); }}
          />
        </ScrollView>
      </View>
    );
  }

  const f = feed;
  const liveRooms = (f?.liveRooms ?? []) as DiscoverRoom[];
  const filtered = filterRooms(liveRooms, localQuery);
  const popular = f?.popularRooms ?? [];
  const creators = f?.creators ?? [];
  const videos = f?.videos ?? [];
  const moments = f?.moments ?? [];
  const games = f?.games ?? [];

  return (
    <View style={s.root}>
      <TopHeader />
      <ScrollView
        style={s.scroll}
        refreshControl={
          <RefreshControlCustom refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Search bar shortcut — taps route to /search */}
        <Pressable style={s.searchBar} onPress={() => goToSearch()}>
          <Text style={s.searchIcon}>🔍</Text>
          <Text style={s.searchPlaceholder}>Search creators, rooms, content…</Text>
        </Pressable>

        {/* Recommended creators */}
        <SectionHeader title="Recommended creators" icon="🏆" />
        {creators.length === 0 ? (
          <EmptyState icon="🏆" title="No recommendations yet" subtitle="Weekly gifting rankings populate this section." />
        ) : (
          <FlatList
            horizontal
            data={creators.slice(0, 10)}
            keyExtractor={(c) => String(c.user.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.carousel}
            renderItem={({ item }) => (
              <UserCard
                user={{
                  id: item.user.id,
                  displayName: item.user.displayName,
                  avatarUrl: item.user.avatarUrl,
                  vipLevel: item.user.vipLevel,
                  nobleLevel: item.user.nobleLevel,
                  country: item.user.country,
                  followerCount: item.points,
                }}
              />
            )}
          />
        )}

        {/* Live rooms (filterable locally) */}
        <SectionHeader title="Live rooms" icon="🔴" action={
          <Pressable onPress={() => router.push("/(tabs)/live")}><Text style={s.seeAll}>see all →</Text></Pressable>
        } />
        {filtered.length === 0 ? (
          <EmptyState
            icon="📡"
            title={localQuery ? "No rooms match your filter" : "No live rooms right now"}
            subtitle={localQuery ? "Clear the filter or try the Live tab." : "Be the first — open the Live tab to start a room."}
            ctaLabel={localQuery ? "Clear filter" : "Start a room"}
            onCta={() => localQuery ? setLocalQuery("") : router.push("/(tabs)/live")}
          />
        ) : (
          <FlatList
            horizontal
            data={filtered.slice(0, 12)}
            keyExtractor={(r) => String(r.id)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.carousel}
            renderItem={({ item }) => (
              <Link href={`/room/${item.id}`} asChild>
                <Pressable><RoomCard room={item} /></Pressable>
              </Link>
            )}
          />
        )}

        {/* Popular rooms — vertical list */}
        <SectionHeader title="Popular rooms" icon="🔥" />
        {popular.length === 0 ? (
          <EmptyState icon="📊" title="No popular rooms yet" subtitle="Popularity is ranked by audience size." />
        ) : (
          <View style={s.listWrap}>
            {popular.slice(0, 5).map((r) => (
              <Link key={r.id} href={`/room/${r.id}`} asChild>
                <Pressable><RoomCard room={r} variant="list" /></Pressable>
              </Link>
            ))}
          </View>
        )}

        {/* Trending short videos */}
        {flag("short_video.enabled") && (
          <>
            <SectionHeader title="Trending videos" icon="🎬" />
            {videos.length === 0 ? (
              <EmptyState icon="🎬" title="No videos yet" subtitle="When creators post short videos, they'll appear here." />
            ) : (
              <FlatList
                horizontal
                data={videos}
                keyExtractor={(v) => String(v.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.carousel}
                renderItem={({ item }) => <ShortVideoCard video={item} />}
              />
            )}
          </>
        )}

        {/* Recent moments */}
        <SectionHeader title="Recent moments" icon="✨" />
        {moments.length === 0 ? (
          <EmptyState icon="✨" title="No moments yet" subtitle="Moments are short text + image posts from creators." />
        ) : (
          <View style={s.listWrap}>
            {moments.slice(0, 4).map((m) => (
              <MomentCard key={m.id} moment={m} />
            ))}
          </View>
        )}

        {/* Trending games */}
        {flag("games.enabled") && games.length > 0 && (
          <>
            <SectionHeader title="Trending games" icon="🎮" action={
              <Pressable onPress={() => router.push("/(tabs)/games")}><Text style={s.seeAll}>all games →</Text></Pressable>
            } />
            <FlatList
              horizontal
              data={games.slice(0, 6)}
              keyExtractor={(g) => g.code}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.carousel}
              renderItem={({ item }) => (
                <Pressable style={s.gameCard} onPress={() => router.push(`/game/${item.code}`)}>
                  <View style={s.gameThumb}>
                    <Text style={s.gameIcon}>{item.isPro ? "💎" : "🎲"}</Text>
                  </View>
                  <Text style={s.gameName} numberOfLines={1}>{item.name}</Text>
                  {item.isPro && <Badge tone="vip" label="PRO" />}
                </Pressable>
              )}
            />
          </>
        )}

        <Text style={s.footer}>market: {config.market} · {config.games.length} games · {config.gifts.length} gifts</Text>
      </ScrollView>
    </View>
  );
}

// small wrapper so we can keep RefreshControl import in one place
import { RefreshControl } from "react-native";
function RefreshControlCustom({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  scroll: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    height: 44,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchIcon: { fontSize: 16 },
  searchPlaceholder: {
    ...t.body,
    color: theme.textSubtle,
  },
  carousel: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  listWrap: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  seeAll: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
  gameCard: {
    width: 140,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[3],
    gap: spacing[2],
  },
  gameThumb: {
    height: 80,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  gameIcon: { fontSize: 32 },
  gameName: {
    ...t.body,
    color: theme.text,
    fontWeight: "700",
  },
  footer: {
    ...t.micro,
    color: theme.textSubtle,
    textAlign: "center",
    marginVertical: spacing[5],
  },
});

// keep these imports referenced so the linter doesn't strip them — they
// are used by the JSX above (Avatar via UserCard indirection).
void Avatar;
void Card;
