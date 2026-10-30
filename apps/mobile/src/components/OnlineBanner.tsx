/**
 * SM Live — OnlineBanner (Prompt 13).
 *
 * A slim banner that renders above the Stack when the device cannot
 * reach the API. The banner is intentionally subtle (not a modal) —
 * the user can still navigate; the API client will retry on the next
 * interaction.
 *
 * Polls GET /health every 30s via useOnline. The poll is paused when
 * the banner is not visible (the hook handles that internally via the
 * `enabled` flag).
 *
 * The banner is non-blocking and dismissible; tapping it forces an
 * immediate re-probe so the user can confirm "is it back yet?".
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useOnline } from "../hooks/useOnline";
import { theme, t, spacing } from "../theme";

export function OnlineBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { online, lastCheckedAt } = useOnline(true);

  if (online || dismissed) return null;

  const since = lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "—";
  return (
    <Pressable
      onPress={() => setDismissed(true)}
      accessibilityRole="alert"
      accessibilityLabel="You appear to be offline. Tap to dismiss."
      style={s.banner}
    >
      <View style={s.dot} />
      <Text style={s.text}>You're offline · last checked {since}</Text>
      <Text style={s.dismiss}>tap to dismiss</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: theme.warning,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.textInverse,
  },
  text: { ...t.caption, color: theme.textInverse, flex: 1, fontWeight: "600" },
  dismiss: { ...t.micro, color: theme.textInverse, opacity: 0.8 },
});
