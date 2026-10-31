import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { Button, Input, theme, t, spacing, radius } from "../../src/components";
import { TICKET_CATEGORIES } from "../../src/hooks/notificationPure";

export default function NewTicketScreen() {
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number } | null>(null);

  const submit = async () => {
    if (submitting) return;
    if (subject.trim().length < 3) { setError("Subject must be at least 3 characters"); return; }
    if (description.trim().length < 1) { setError("Description is required"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ id: number }>("/v1/support/tickets", {
        method: "POST",
        json: { subject: subject.trim(), description: description.trim(), category },
      });
      setDone({ id: res.id });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={s.center}>
        <Text style={s.doneIcon}>✓</Text>
        <Text style={s.doneTitle}>Ticket Created!</Text>
        <Text style={s.doneBody}>Your ticket #{done.id} has been submitted. Our support team will review it shortly.</Text>
        <View style={s.doneActions}>
          <Button label="View Ticket" onPress={() => router.replace(`/support/${done.id}`)} style={{ flex: 1 }} />
          <Button variant="ghost" label="Back to Support" onPress={() => router.replace("/support")} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
      <Text style={s.title}>Create Support Ticket</Text>

      <Text style={s.label}>Category</Text>
      <View style={s.categoryWrap}>
        {TICKET_CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            style={[s.categoryChip, category === c.key && s.categoryChipActive]}
            onPress={() => setCategory(c.key)}
          >
            <Text style={s.categoryIcon}>{c.icon}</Text>
            <Text style={[s.categoryText, category === c.key && s.categoryTextActive]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      <Input
        label="Subject"
        value={subject}
        onChangeText={(v) => { setSubject(v); if (error) setError(null); }}
        placeholder="Brief summary of the issue"
        maxLength={120}
      />

      <Text style={s.label}>Description</Text>
      <Input
        value={description}
        onChangeText={(v) => { setDescription(v); if (error) setError(null); }}
        placeholder="Describe your issue in detail…"
        multiline
        numberOfLines={5}
        maxLength={4000}
        style={{ minHeight: 120, textAlignVertical: "top" }}
      />

      {error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.actions}>
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button label="Submit" onPress={submit} loading={submitting} disabled={submitting} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg, padding: spacing[5], gap: spacing[2] },
  doneIcon: { fontSize: 48, color: "#34d399" },
  doneTitle: { ...t.h1, color: "#34d399" },
  doneBody: { ...t.body, color: "#94a3b8", textAlign: "center", lineHeight: 22 },
  doneActions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[4] },
  title: { ...t.h1, color: theme.text },
  label: { ...t.caption, color: theme.textSubtle, fontWeight: "600" },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  categoryChip: { flexDirection: "row", alignItems: "center", gap: spacing[1], backgroundColor: theme.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  categoryChipActive: { borderColor: theme.primary, backgroundColor: "rgba(124,58,237,0.12)" },
  categoryIcon: { fontSize: 14 },
  categoryText: { ...t.micro, color: theme.textMuted, fontWeight: "600" },
  categoryTextActive: { color: theme.primaryMuted },
  errorBox: { backgroundColor: "rgba(251,113,133,0.12)", borderLeftWidth: 3, borderLeftColor: theme.danger, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.md },
  errorText: { ...t.caption, color: theme.danger },
  actions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
});
