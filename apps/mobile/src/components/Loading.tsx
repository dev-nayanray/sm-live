/**
 * SM Live — loading indicator (Prompt 13).
 *
 * Two modes:
 *   inline   → a small spinner + label, used inside cards / sections.
 *   overlay  → a full-screen overlay used for in-flight mutations
 *              (login, register, recharge). Disables interaction with the
 *              underlying view so the user can't double-submit.
 *
 * Both modes use the brand purple as the spinner color so the visual
 * matches the rest of the app's accent.
 */
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";
import { typography } from "../theme/typography";

export interface LoadingProps {
  label?: string;
  /** When true, renders a full-screen modal overlay. */
  overlay?: boolean;
}

export function Loading({ label, overlay }: LoadingProps) {
  if (overlay) {
    return (
      <Modal transparent animationType="fade" visible>
        <View style={s.overlay}>
          <View style={s.overlayCard}>
            <ActivityIndicator color={theme.primary} size="large" />
            {label ? <Text style={s.overlayLabel}>{label}</Text> : null}
          </View>
        </View>
      </Modal>
    );
  }
  return (
    <View style={s.inline}>
      <ActivityIndicator color={theme.primary} size="small" />
      {label ? <Text style={s.inlineLabel}>{label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  inline: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  inlineLabel: {
    ...typography.caption,
    color: theme.textSubtle,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 12,
    minWidth: 120,
  },
  overlayLabel: {
    ...typography.caption,
    color: theme.text,
  },
});
