import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { Button, Card, SectionHeader, theme, t, spacing } from "../src/components";

/**
 * SM Live — Privacy policy (Prompt 13).
 *
 * Same pattern as Terms: ships a placeholder that explicitly says it's a
 * draft. The body documents the actual data handling the platform
 * performs today so a user can make an informed choice — this is more
 * honest than copy-pasting a generic policy that doesn't reflect the
 * codebase.
 */
export default function Privacy() {
  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <Text style={s.title}>Privacy policy</Text>

      <Card>
        <SectionHeader title="Status" icon="ℹ️" />
        <Text style={s.body}>
          The binding privacy policy for SM Live is being drafted. Until the final
          version is published, this page documents the actual data handling the
          platform performs today.
        </Text>
      </Card>

      <Card>
        <SectionHeader title="What we store" icon="🗄️" />
        <Text style={s.body}>
          • Account credentials: phone or email, password (bcrypt-hashed), display name.
          {"\n"}
          • Wallet: balance (integer coins), ledger entries with a stable
          <Text style={s.mono}> txKey</Text> for idempotency.
          {"\n"}
          • Activity: rooms you joined, gifts you sent or received, game sessions and
          bets, support tickets and messages.
          {"\n"}
          • Sessions: refresh tokens (hashed), user-agent, IP (recorded on admin
          actions for audit).
        </Text>
      </Card>

      <Card>
        <SectionHeader title="What we don't store" icon="🚫" />
        <Text style={s.body}>
          • Plaintext passwords — never.
          {"\n"}
          • Payment instrument numbers — the boilerplate ships with a fake payment
          adapter; real-money integration is gated by the
          <Text style={s.mono}> real_money.enabled</Text> flag (off by default).
          {"\n"}
          • Location history — we store the country code you set on your profile;
          GPS is not requested.
          {"\n"}
          • Contacts — the app does not request access to your address book.
        </Text>
      </Card>

      <Card>
        <SectionHeader title="Your choices" icon="⚙️" />
        <Text style={s.body}>
          You can adjust notification and privacy preferences in Settings. To delete
          your account or request a data export, contact support — every deletion is
          recorded in the audit log.
        </Text>
      </Card>

      <Pressable style={s.backWrap} onPress={() => router.back()}>
        <Button variant="ghost" label="← back" />
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  title: { ...t.h1, color: theme.text, paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  body: { ...t.body, color: theme.textMuted, lineHeight: 22 },
  mono: { ...t.caption, fontFamily: "monospace", color: theme.primaryMuted },
  backWrap: { paddingHorizontal: spacing[4], marginTop: spacing[5] },
});
