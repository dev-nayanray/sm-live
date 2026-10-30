import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { Button, Card, SectionHeader, theme, t, spacing } from "../src/components";

/**
 * SM Live — Terms of service (Prompt 13).
 *
 * The platform ships a placeholder legal page rather than fake boilerplate.
 * Real legal copy must be drafted by counsel and merged via PR — the
 * screen renders an explicit "draft pending" notice so the user is never
 * misled into thinking they've agreed to binding terms.
 *
 * When the final copy lands, replace the body of this file with the
 * approved text. The layout (scroll + section headers + back button) is
 * generic enough to host the final terms verbatim.
 */
export default function Terms() {
  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <Text style={s.title}>Terms of service</Text>

      <Card>
        <SectionHeader title="Status" icon="ℹ️" />
        <Text style={s.body}>
          The binding terms of service for SM Live are being drafted. Until the final
          version is published, this page is a placeholder — your use of the platform
          remains subject to the policies communicated by your account administrator.
        </Text>
      </Card>

      <Card>
        <SectionHeader title="What you can expect today" icon="✅" />
        <Text style={s.body}>
          • Virtual coins only — no real-money transactions are enabled in the
          boilerplate; the master <Text style={s.mono}>real_money.enabled</Text> flag is
          seeded off.
          {"\n\n"}
          • Your account credentials are stored hashed (bcrypt) and never logged in
          plaintext.
          {"\n\n"}
          • You can request a copy of your data or delete your account by contacting
          support — the API enforces user-scoped queries so other users cannot read
          your private fields.
        </Text>
      </Card>

      <Card>
        <SectionHeader title="Acceptable use" icon="📋" />
        <Text style={s.body}>
          Harassment, spam, impersonation, and any unlawful content are prohibited.
          Admins can restrict, mute, or ban accounts that violate these guidelines.
          Restrictions are recorded in the audit log with a reason.
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
