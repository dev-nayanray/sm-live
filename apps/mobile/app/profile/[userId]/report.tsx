import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { api } from "../../../src/api/client";
import { Button, Input, theme, t, spacing, radius } from "../../../src/components";
import { REPORT_REASONS } from "../../../src/hooks/socialPure";

export default function ReportUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const [reason, setReason] = useState<string>("other");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/v1/social/report/${userId}`, {
        method: "POST",
        json: { reason, details: details.trim() },
      });
      setDone(true);
    } catch {
      setError("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={s.center}>
        <Text style={s.doneIcon}>✓</Text>
        <Text style={s.doneTitle}>Report Submitted</Text>
        <Text style={s.doneBody}>Thank you. Our team will review the report and take appropriate action.</Text>
        <Button label="Done" onPress={() => router.back()} style={{ marginTop: spacing[4] }} />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
      <Text style={s.title}>Report User</Text>
      <Text style={s.subtitle}>Help us keep SM Live safe. Select a reason and add details if you'd like.</Text>

      <View style={s.reasonsWrap}>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r.key}
            style={[s.reasonCard, reason === r.key && s.reasonCardActive]}
            onPress={() => setReason(r.key)}
          >
            <Text style={[s.reasonLabel, reason === r.key && s.reasonLabelActive]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>

      <Input
        label="Additional details (optional)"
        value={details}
        onChangeText={setDetails}
        placeholder="Describe what happened…"
        multiline
        numberOfLines={4}
        maxLength={1000}
        style={{ minHeight: 80, textAlignVertical: "top" }}
      />

      {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}

      <View style={s.actionsRow}>
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button label="Submit Report" onPress={submit} loading={submitting} disabled={submitting} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg, padding: spacing[5], gap: spacing[2] },
  doneIcon: { fontSize: 48, color: theme.success },
  doneTitle: { ...t.h1, color: theme.success },
  doneBody: { ...t.body, color: theme.textMuted, textAlign: "center", lineHeight: 22 },
  title: { ...t.h1, color: theme.text },
  subtitle: { ...t.caption, color: theme.textSubtle, lineHeight: 20 },
  reasonsWrap: { gap: spacing[2] },
  reasonCard: { backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing[3] },
  reasonCardActive: { borderColor: theme.primary, backgroundColor: "rgba(124,58,237,0.12)" },
  reasonLabel: { ...t.body, color: theme.textMuted, fontWeight: "600" },
  reasonLabelActive: { color: theme.primaryMuted },
  errorBox: { backgroundColor: "rgba(251,113,133,0.12)", borderLeftWidth: 3, borderLeftColor: theme.danger, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.md },
  errorText: { ...t.caption, color: theme.danger },
  actionsRow: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
});
