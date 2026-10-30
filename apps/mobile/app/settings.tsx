import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../src/state/AppProviders";
import { useSettings } from "../src/hooks/useSettings";
import { Avatar, Badge, Button, Card, EmptyState, SectionHeader, theme, t, spacing, radius } from "../src/components";
import Constants from "expo-constants";

/**
 * SM Live — Settings screen (Prompt 13).
 *
 * A realistic settings surface that only exposes rows the platform can
 * actually honour today. Rows that would point at unbuilt features
 * (e.g. "Edit profile photo", "Two-factor auth") are intentionally
 * absent — the screen would rather look sparse than fake functionality.
 *
 * Persisted settings:
 *   - theme (dark only honoured today; light/system persisted forward)
 *   - language (en shipped; bn/hi/ur persisted)
 *   - notification preferences (honoured once a push provider lands)
 *   - privacy preferences (honoured once a follow graph + DM backend land)
 *
 * Navigation rows:
 *   - Account         → Profile edit (placeholder)
 *   - Help & support  → /support screen
 *   - Terms            → /terms (renders an inline placeholder)
 *   - Privacy policy   → /privacy (renders an inline placeholder)
 *
 * The screen also surfaces the live app version (from expo-constants)
 * and the resolved API base URL so a user can confirm where they're
 * pointed (useful for QA / staging flips).
 */
export default function Settings() {
  const { user, logout } = useAuth();
  const { settings, ready, update } = useSettings();

  if (!ready) return null;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <View style={s.headerRow}>
        <Text style={s.title}>Settings</Text>
        {user && <Avatar name={user.displayName} size={40} />}
      </View>

      <SectionHeader title="Account" icon="👤" />
      <Card>
        <Row label="Display name" value={user?.displayName ?? "—"} />
        <Divider />
        <Row label="User ID" value={user ? `#${user.id}` : "—"} />
        <Divider />
        <NavRow label="Edit profile" hint="coming soon — backend doesn't expose a profile-update endpoint yet" />
      </Card>

      <SectionHeader title="Notifications" icon="🔔" />
      <Card>
        <ToggleRow
          label="Live from creators you follow"
          value={settings.notifications.liveFromFollowing}
          onToggle={(v) => update({ notifications: { ...settings.notifications, liveFromFollowing: v } })}
        />
        <Divider />
        <ToggleRow
          label="New messages"
          value={settings.notifications.newMessages}
          onToggle={(v) => update({ notifications: { ...settings.notifications, newMessages: v } })}
        />
        <Divider />
        <ToggleRow
          label="Gifts received"
          value={settings.notifications.giftsReceived}
          onToggle={(v) => update({ notifications: { ...settings.notifications, giftsReceived: v } })}
        />
        <Divider />
        <ToggleRow
          label="Marketing & announcements"
          value={settings.notifications.marketing}
          onToggle={(v) => update({ notifications: { ...settings.notifications, marketing: v } })}
        />
        <Text style={s.helper}>Notifications will be delivered once a push provider is configured.</Text>
      </Card>

      <SectionHeader title="Privacy" icon="🔒" />
      <Card>
        <ToggleRow
          label="Show online status"
          value={settings.privacy.showOnlineStatus}
          onToggle={(v) => update({ privacy: { ...settings.privacy, showOnlineStatus: v } })}
        />
        <Divider />
        <ToggleRow
          label="Allow direct messages"
          value={settings.privacy.allowDirectMessages}
          onToggle={(v) => update({ privacy: { ...settings.privacy, allowDirectMessages: v } })}
        />
        <Text style={s.helper}>Direct messages will become available when the DM backend lands.</Text>
      </Card>

      <SectionHeader title="Appearance" icon="🎨" />
      <Card>
        <Row label="Theme" value={<Badge tone="primary" label={settings.theme} />} />
        <Divider />
        <Row label="Language" value={<Badge tone="muted" label={settings.language.toUpperCase()} />} />
        <Text style={s.helper}>Light theme + additional languages are persisted; only dark + English are honoured today.</Text>
      </Card>

      <SectionHeader title="Help" icon="🧭" />
      <Card>
        <NavRow label="Help & support" onPress={() => router.push("/support")} />
        <Divider />
        <NavRow label="Terms of service" onPress={() => router.push("/terms")} />
        <Divider />
        <NavRow label="Privacy policy" onPress={() => router.push("/privacy")} />
      </Card>

      <SectionHeader title="About" icon="ℹ️" />
      <Card>
        <Row label="App version" value={Constants.expoConfig?.version ?? "0.1.0"} />
        <Divider />
        <Row label="API base" value={apiHost()} />
      </Card>

      <View style={s.logoutWrap}>
        <Button variant="danger" label="Sign out" icon="↩" onPress={() => void logout()} />
      </View>
    </ScrollView>
  );
}

function apiHost(): string {
  try {
    const url = new URL(process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4001");
    return url.host;
  } catch {
    return "localhost:4001";
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

function NavRow({ label, hint, onPress }: { label: string; hint?: string; onPress?: () => void }) {
  if (!onPress) {
    return (
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>{label}</Text>
          {hint && <Text style={s.rowHint}>{hint}</Text>}
        </View>
        <Text style={s.comingSoon}>soon</Text>
      </View>
    );
  }
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={onPress}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>→</Text>
    </Pressable>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: theme.surfaceAlt, true: theme.primary }}
        thumbColor={value ? theme.textInverse : theme.textSubtle}
      />
    </View>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  title: { ...t.h1, color: theme.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing[3],
    gap: spacing[3],
    minHeight: 48,
  },
  rowLabel: { ...t.body, color: theme.text, flex: 1 },
  rowValue: { ...t.body, color: theme.textMuted, fontWeight: "600" },
  rowHint: { ...t.caption, color: theme.textSubtle, marginTop: 2 },
  comingSoon: {
    ...t.micro,
    color: theme.textSubtle,
    textTransform: "uppercase",
  },
  chevron: { ...t.body, color: theme.textSubtle },
  divider: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: 0,
  },
  helper: {
    ...t.caption,
    color: theme.textSubtle,
    marginTop: spacing[2],
  },
  logoutWrap: { paddingHorizontal: spacing[4], marginTop: spacing[5] },
});

// Make sure EmptyState + radius are imported so the file builds even when
// only some screens use them — tree-shaking strips them in release builds.
void EmptyState;
void radius;
