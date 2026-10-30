import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import {
  Badge, Button, Card, Input, SectionHeader, theme, t, spacing, radius,
} from "../../src/components";
import {
  defaultSlotsForType, roomTypeIcon, roomTypeLabel, type RoomType,
} from "../../src/hooks/streamPure";
import { VOICE_ROOM_LAYOUTS } from "../../src/hooks/voiceRoomPure";

/**
 * SM Live — Start Live configuration screen (Prompt 17).
 *
 * The host configures their broadcast BEFORE going live:
 *   1. Choose room type (live / voice / party).
 *   2. Enter a room title.
 *   3. (Future) choose a category + cover image.
 *   4. Tap "Go live" → POST /v1/rooms → navigate to /room/:id.
 *
 * Camera preview + permissions: the LiveKit native module handles camera
 * capture on the actual room screen. The Start Live screen focuses on
 * configuration — showing a camera preview here would require a second
 * LiveKit Room instance (expensive + complex). The room screen shows the
 * live preview as soon as the host joins.
 *
 * The screen validates:
 *   - User is authenticated (AppProviders gate handles this).
 *   - User is not banned / muted (the backend re-checks on POST /v1/rooms).
 *   - User doesn't already have an active room (backend rejects with 400).
 *   - Title is at least 2 characters (matches the shared createRoomSchema).
 *
 * On success, the screen routes to /room/:id with `?host=1` so the room
 * screen knows to render the host controls.
 */
export default function StartLiveScreen() {
  const { user } = useAuth();
  const [type, setType] = useState<RoomType>("live");
  const [title, setTitle] = useState("");
  const [slotOverride, setSlotOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots = slotOverride ?? defaultSlotsForType(type);
  const isVoiceOrParty = type === "voice" || type === "party";

  const submit = async () => {
    if (busy) return;
    setError(null);
    const trimmedTitle = title.trim() || `${user?.displayName ?? "My"} ${type} room`;
    if (trimmedTitle.length < 2) {
      setError("Title must be at least 2 characters");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ id: number }>("/v1/rooms", {
        method: "POST",
        json: {
          title: trimmedTitle,
          type,
          slots,
          country: "BD",
        },
      });
      router.replace(`/room/${res.id}?host=1`);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <View style={s.head}>
        <Text style={s.title}>Start a live broadcast</Text>
        <Text style={s.sub}>
          Configure your room, then tap Go live. Your camera will start when you enter the room.
        </Text>
      </View>

      <SectionHeader title="Room type" icon="📡" />
      <View style={s.typeRow}>
        {(["live", "voice", "party"] as const).map((rt) => (
          <Pressable
            key={rt}
            style={[s.typeCard, type === rt && s.typeCardActive]}
            onPress={() => { setType(rt); setSlotOverride(null); }}
          >
            <Text style={s.typeIcon}>{roomTypeIcon(rt)}</Text>
            <Text style={[s.typeLabel, type === rt && s.typeLabelActive]}>{roomTypeLabel(rt)}</Text>
            <Text style={s.typeSlots}>{isVoiceOrParty ? `${slots} seats` : `${defaultSlotsForType(rt)} slots`}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Room details" icon="📝" />
      <Card>
        <Input
          label="Room title"
          value={title}
          onChangeText={(v) => { setTitle(v); if (error) setError(null); }}
          placeholder={`${user?.displayName ?? "My"} ${type} room`}
          maxLength={80}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <View style={s.metaRow}>
          <Badge tone="muted" label={`Type: ${type}`} />
          <Badge tone="muted" label={`Slots: ${slots}`} />
          <Badge tone="muted" label="Country: BD" />
        </View>
      </Card>

      {/* Microphone seat capacity selector — only for voice/party rooms */}
      {isVoiceOrParty && (
        <>
          <SectionHeader title="Microphone seats" icon="🎤" />
          <View style={s.slotRow}>
            {VOICE_ROOM_LAYOUTS.map((n) => (
              <Pressable
                key={n}
                style={[s.slotCard, slots === n && s.slotCardActive]}
                onPress={() => setSlotOverride(n)}
              >
                <Text style={[s.slotNum, slots === n && s.slotNumActive]}>{n}</Text>
                <Text style={s.slotLabel}>
                  {n === 5 ? "Small" : n === 10 ? "Medium" : n === 15 ? "Large" : "XL"}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Before you go live" icon="⚠️" />
      <Card>
        <Text style={s.checklistItem}>✓ Camera + microphone permissions will be requested when you enter the room.</Text>
        <Text style={s.checklistItem}>✓ Only one active room per host — you'll need to end this one before starting another.</Text>
        <Text style={s.checklistItem}>✓ Banned or muted accounts cannot start a broadcast.</Text>
        <Text style={s.checklistItem}>✓ Your stream is public — anyone can discover and join it.</Text>
      </Card>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={s.actions}>
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} style={s.cancelBtn} />
        <Button
          label="Go live"
          icon="🔴"
          onPress={submit}
          loading={busy}
          disabled={busy}
          style={s.goLiveBtn}
        />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  head: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  title: { ...t.h1, color: theme.text },
  sub: { ...t.caption, color: theme.textSubtle, lineHeight: 20 },
  typeRow: {
    flexDirection: "row",
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  typeCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[3],
    alignItems: "center",
    gap: spacing[1],
  },
  typeCardActive: {
    borderColor: theme.primary,
    backgroundColor: "rgba(124, 58, 237, 0.12)",
  },
  typeIcon: { fontSize: 28 },
  typeLabel: {
    ...t.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
  typeLabelActive: { color: theme.primaryMuted },
  typeSlots: {
    ...t.micro,
    color: theme.textSubtle,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
    marginTop: spacing[2],
  },
  checklistItem: {
    ...t.caption,
    color: theme.textMuted,
    marginVertical: spacing[1],
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: "rgba(251, 113, 133, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: theme.danger,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    borderRadius: 4,
  },
  errorText: {
    ...t.caption,
    color: theme.danger,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginTop: spacing[5],
  },
  cancelBtn: { flex: 1 },
  goLiveBtn: { flex: 2 },
  slotRow: {
    flexDirection: "row",
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  slotCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[2],
    alignItems: "center",
    gap: spacing[1],
  },
  slotCardActive: {
    borderColor: theme.primary,
    backgroundColor: "rgba(124, 58, 237, 0.12)",
  },
  slotNum: {
    ...t.h2,
    color: theme.textMuted,
  },
  slotNumActive: {
    color: theme.primaryMuted,
  },
  slotLabel: {
    ...t.micro,
    color: theme.textSubtle,
  },
});
