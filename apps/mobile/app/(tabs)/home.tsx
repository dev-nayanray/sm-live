import { Link, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";
import {
  EmptyState, ErrorState, Loading, MomentCard, RoomCard, SectionHeader,
  ShortVideoCard, TopHeader, UserCard, theme, t, spacing, type BadgeTone,
} from "../../src/components";
import {
  type HomeFeedCategory, sortRoomsByAudience,
} from "../../src/hooks/feedPure";

/**
 * SM Live — Home feed (Prompt 15).
 *
 * Rewritten from the original to use the new /v1/feed/home aggregator
 * (single round-trip) + the design-system cards (RoomCard, UserCard,
 * ShortVideoCard, MomentCard) + the TopHeader.
 *
 * Features:
 *   - Top header with brand + search + notifications + wallet + avatar.
 *   - Category chips: For You / Live / Popular / Creators. Selecting a
 *     category re-fetches the feed with the matching filter; the
 *     backend decides what each category returns.
 *   - Live Now: horizontal carousel of open live-type rooms.
 *   - Popular rooms: horizontal carousel ranked by audience count.
 *   - Recommended creators: horizontal carousel of weekly-top gifters.
 *   - Short videos + moments (when the short_video.enabled flag is on).
 *   - Pull-to-refresh + error retry + empty state per section.
 *
 * Real data only — the backend filters closedAt=null server-side so the
 * list never shows stale "live" rooms. No fake viewer counts or invented
 * recommendations.
 *
 * Pagination: the home feed endpoint returns up to 20 rooms / 10 popular
 * / 10 live / 10 creators — enough for the discovery surface. Deeper
 * pagination happens on the dedicated Live + Discover tabs (which call
 * /v1/rooms directly with pageSize).
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

const CATEGORIES: Array<{ key: HomeFeedCategory; label: string }> = [
  { key: "for_you", label: "For You" },
  { key: "live", label: "Live" },
  { key: "popular", label: "Popular" },
  { key: "creators", label: "Creators" },
];

export default function Home() {
  const { config, flag } = useAppConfig();
  const { user } = useAuth();
  const [category, setCategory] = useState<HomeFeedCategory>("for_you");
  const [feed, setFeed] = useState<HomeFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cat: HomeFeedCategory) => {
    setError(null);
    try {
      const data = await api<HomeFeedResponse>(`/v1/feed/home?category=${cat}`);
      setFeed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(category); }, [category, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(category);
  }, [category, load]);

  if (loading && !feed) return <><TopHeader /><Loading label="Loading home feed…" /></>;

  if (error && !feed) {
    return (
      <View style={s.root}>
        <TopHeader />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        >
          <ErrorState
            title="Couldn't load your feed"
            subtitle="Pull down to retry. If the problem persists, the backend may be unreachable."
            technical={error}
            ctaLabel="Retry"
            onCta={() => { setLoading(true); void load(category); }}
          />
        </ScrollView>
      </View>
    );
  }

  const f = feed;
  const liveRooms = f?.liveRooms ?? [];
  const popular = sortRoomsByAudience(f?.popularRooms ?? []);
  const rooms = f?.rooms ?? [];
  const creators = f?.creators ?? [];
  const videos = f?.videos ?? [];
  const moments = f?.moments ?? [];
  const games = f?.games ?? [];

  return (
    <View style={s.root}>
      <TopHeader />
      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {/* Greeting + category chips */}
        <View style={s.greeting}>
          <Text style={s.greetingTitle}>Hey {user?.displayName?.split(" ")[0] ?? "there"} 👋</Text>
          <Text style={s.greetingSub}>Discover what's happening on SM Live right now.</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
          {CATEGORIES.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setCategory(c.key)}
              style={[s.chip, category === c.key && s.chipActive]}
            >
              <Text style={[s.chipText, category === c.key && s.chipTextActive]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Live Now — only render when the category is for_you or live */}
        {(category === "for_you" || category === "live") && (
          <>
            <SectionHeader title="Live now" icon="🔴" action={
              <Pressable onPress={() => router.push("/(tabs)/live")}><Text style={s.seeAll}>see all →</Text></Pressable>
            } />
            {liveRooms.length === 0 ? (
              <EmptyState
                icon="📡"
                title="No live rooms right now"
                subtitle="Be the first — open the Live tab to start a room."
                ctaLabel="Start a room"
                onCta={() => router.push("/(tabs)/live")}
              />
            ) : (
              <FlatList
                horizontal
                data={liveRooms.slice(0, 10)}
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
          </>
        )}

        {/* Popular rooms — only render when for_you or popular */}
        {(category === "for_you" || category === "popular") && (
          <>
            <SectionHeader title="Popular rooms" icon="🔥" action={
              <Pressable onPress={() => router.push("/(tabs)/live")}><Text style={s.seeAll}>see all →</Text></Pressable>
            } />
            {popular.length === 0 ? (
              <EmptyState icon="📊" title="No popular rooms yet" subtitle="Popularity is ranked by audience size — join a room to bump it up." />
            ) : (
              <FlatList
                horizontal
                data={popular.slice(0, 10)}
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
          </>
        )}

        {/* All rooms — newest first (only on for_you) */}
        {category === "for_you" && rooms.length > 0 && (
          <>
            <SectionHeader title="Fresh rooms" icon="✨" action={
              <Pressable onPress={() => router.push("/(tabs)/live")}><Text style={s.seeAll}>see all →</Text></Pressable>
            } />
            <FlatList
              horizontal
              data={rooms.slice(0, 10)}
              keyExtractor={(r) => String(r.id)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.carousel}
              renderItem={({ item }) => (
                <Link href={`/room/${item.id}`} asChild>
                  <Pressable><RoomCard room={item} /></Pressable>
                </Link>
              )}
            />
          </>
        )}

        {/* Recommended creators — only render when for_you or creators */}
        {(category === "for_you" || category === "creators") && (
          <>
            <SectionHeader title="Recommended creators" icon="🏆" action={
              <Pressable onPress={() => router.push("/(tabs)/discover")}><Text style={s.seeAll}>discover →</Text></Pressable>
            } />
            {creators.length === 0 ? (
              <EmptyState icon="🏆" title="No ranking data yet" subtitle="Weekly gifting rankings refresh when users start sending gifts." />
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
                      followerCount: item.points, // we don't have follower count; show ranking points as a stand-in
                    }}
                  />
                )}
              />
            )}
          </>
        )}

        {/* Short videos — only when short_video.enabled flag is on */}
        {category === "for_you" && flag("short_video.enabled") && (
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
                renderItem={({ item }) => (
                  <ShortVideoCard video={item} />
                )}
              />
            )}
          </>
        )}

        {/* Moments — only when for_you */}
        {category === "for_you" && (
          <>
            <SectionHeader title="Moments" icon="✨" />
            {moments.length === 0 ? (
              <EmptyState icon="✨" title="No moments yet" subtitle="Moments are short text + image posts from creators." />
            ) : (
              <View style={s.momentsGrid}>
                {moments.slice(0, 4).map((m) => (
                  <MomentCard key={m.id} moment={m} style={s.momentCard} />
                ))}
              </View>
            )}
          </>
        )}

        {/* Games — only when games.enabled */}
        {category === "for_you" && flag("games.enabled") && games.length > 0 && (
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
                  {item.isPro && <Text style={s.gamePro}>PRO</Text>}
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  scroll: { flex: 1 },
  greeting: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  greetingTitle: {
    ...t.h1,
    color: theme.text,
  },
  greetingSub: {
    ...t.caption,
    color: theme.textSubtle,
  },
  chipsRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  chipText: {
    ...t.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  chipTextActive: {
    color: theme.textInverse,
  },
  carousel: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  seeAll: {
    ...t.caption,
    color: theme.primaryMuted,
    fontWeight: "600",
  },
  momentsGrid: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  momentCard: {
    marginHorizontal: 0,
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
  gamePro: {
    ...t.micro,
    color: theme.vip,
    fontWeight: "800",
  },
  footer: {
    ...t.micro,
    color: theme.textSubtle,
    textAlign: "center",
    marginVertical: spacing[5],
  },
});

// Keep the BadgeTone type imported for type-narrowing in child components.
void (null as unknown as BadgeTone);
