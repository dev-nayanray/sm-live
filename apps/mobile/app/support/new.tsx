import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { Button, Card, Input, SectionHeader, theme, t, spacing } from "../../src/components";

/**
 * SM Live — Open a new support ticket (Prompt 13).
 *
 * The backend (Prompt 11) accepts POST /v1/admin/support/tickets from
 * admins; the user-facing POST /v1/support/tickets route is NOT yet
 * exposed. Rather than fake a working submission, this screen captures
 * the user's report into local state and explains what happens next.
 *
 * When the user-facing route lands, wire the submit handler to
 * `api("/v1/support/tickets", { method: "POST", json: { ... } })` and
 * route to the ticket detail page on success.
 */
const CATEGORIES = [
  { key: "account_issues", label: "Account issues", icon: "👤" },
  { key: "payment", label: "Wallet / coins", icon: "🪙" },
  { key: "harassment", label: "Report harassment", icon: "🚨" },
  { key: "bug", label: "Bug report", icon: "🐛" },
  { key: "feature_request", label: "Feature request", icon: "💡" },
  { key: "other", label: "Other", icon: "📝" },
] as const;

export default function NewTicket() {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["key"]>("account_issues");
  const [submitted, setSubmitted] = useState(false);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: spacing[6] }}>
      <Text style={s.title}>Open a ticket</Text>

      {submitted ? (
        <Card>
          <SectionHeader title="Captured" icon="✅" />
          <Text style={s.body}>
            Your report has been captured. Once the user-facing ticket submission endpoint
            is live, it will be filed automatically. For now, please copy the details
            below and paste them into the live lobby to reach support.
          </Text>
          <View style={s.summary}>
            <Text style={s.summaryLabel}>Subject</Text>
            <Text style={s.summaryValue}>{subject}</Text>
            <Text style={s.summaryLabel}>Category</Text>
            <Text style={s.summaryValue}>{category}</Text>
            <Text style={s.summaryLabel}>Description</Text>
            <Text style={s.summaryValue}>{description}</Text>
          </View>
          <Button label="Open lobby chat" icon="💬" onPress={() => router.push("/chat/lobby")} />
        </Card>
      ) : (
        <>
          <Card>
            <SectionHeader title="Category" icon="🏷️" />
            <View style={s.catRow}>
              {CATEGORIES.map((c) => (
                <Pressable
                  key={c.key}
                  style={({ pressed }) => [s.cat, category === c.key && s.catActive, pressed && { opacity: 0.7 }]}
                  onPress={() => setCategory(c.key)}
                >
                  <Text style={s.catIcon}>{c.icon}</Text>
                  <Text style={[s.catLabel, category === c.key && s.catLabelActive]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Card>
            <SectionHeader title="Details" icon="📝" />
            <Input
              label="Subject"
              value={subject}
              onChangeText={setSubject}
              placeholder="Short summary of the issue"
              maxLength={120}
            />
            <Text style={s.fieldLabel}>Description</Text>
            <TextInput
              style={s.textArea}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe what happened, what you expected, and what you saw instead."
              placeholderTextColor={theme.textSubtle}
              multiline
              numberOfLines={6}
              maxLength={2000}
              textAlignVertical="top"
            />
            <Text style={s.counter}>{description.length}/2000</Text>
          </Card>

          <View style={s.actionRow}>
            <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
            <Button
              label="Submit"
              icon="📤"
              disabled={!subject.trim() || !description.trim()}
              onPress={() => setSubmitted(true)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  title: { ...t.h1, color: theme.text, paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  body: { ...t.body, color: theme.textMuted, lineHeight: 22 },
  catRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  cat: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: 999,
    backgroundColor: theme.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  catActive: {
    backgroundColor: theme.primary,
  },
  catIcon: { fontSize: 16 },
  catLabel: { ...t.caption, color: theme.textMuted, fontWeight: "600" },
  catLabelActive: { color: theme.textInverse },
  fieldLabel: {
    ...t.caption,
    color: theme.textSubtle,
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },
  textArea: {
    minHeight: 120,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing[3],
    ...t.body,
  },
  counter: {
    ...t.micro,
    color: theme.textSubtle,
    textAlign: "right",
    marginTop: spacing[1],
  },
  summary: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    padding: spacing[3],
    marginVertical: spacing[3],
    gap: spacing[1],
  },
  summaryLabel: { ...t.caption, color: theme.textSubtle, fontWeight: "600" },
  summaryValue: { ...t.body, color: theme.text },
  actionRow: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginTop: spacing[4],
    justifyContent: "flex-end",
  },
});
