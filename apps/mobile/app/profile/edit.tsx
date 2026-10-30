import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../src/api/client";
import { useAuth } from "../../src/state/AppProviders";
import { Button, Input, Loading, theme, t, spacing, radius } from "../../src/components";

interface MyProfile {
  id: number; displayName: string; avatarUrl: string;
  country: string; vipLevel: number; nobleLevel: number;
}

export default function EditProfileScreen() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [country, setCountry] = useState("BD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api<MyProfile>(`/v1/users/${user.id}`);
      setDisplayName(data.displayName);
      setAvatarUrl(data.avatarUrl);
      setCountry(data.country || "BD");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (saving) return;
    if (displayName.trim().length < 2) {
      setError("Display name must be at least 2 characters");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api("/v1/auth/me", {
        method: "PATCH",
        json: {
          displayName: displayName.trim(),
          avatarUrl: avatarUrl.trim(),
          country: country.toUpperCase(),
        },
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading profile…" />;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
      <Text style={s.title}>Edit Profile</Text>

      <Input
        label="Display name"
        value={displayName}
        onChangeText={(v) => { setDisplayName(v); if (error) setError(null); }}
        placeholder="Your display name"
        maxLength={40}
      />

      <Input
        label="Avatar URL"
        value={avatarUrl}
        onChangeText={(v) => { setAvatarUrl(v); if (error) setError(null); }}
        placeholder="https://… (image URL)"
        autoCapitalize="none"
        autoCorrect={false}
        helper="Paste an image URL for your profile photo."
      />

      <Input
        label="Country (2-letter code)"
        value={country}
        onChangeText={(v) => { setCountry(v.toUpperCase().slice(0, 2)); if (error) setError(null); }}
        placeholder="BD"
        maxLength={2}
        autoCapitalize="characters"
      />

      {error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : null}

      {success ? (
        <View style={s.successBox}><Text style={s.successText}>✓ Profile updated!</Text></View>
      ) : null}

      <View style={s.actionsRow}>
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button label="Save" onPress={save} loading={saving} disabled={saving} style={{ flex: 1 }} />
      </View>

      <Text style={s.note}>
        Note: Phone, email, and password changes go through the auth flow (OTP / password reset).
        Avatar image upload requires a file-storage backend — for now, paste a URL.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  title: { ...t.h1, color: theme.text },
  errorBox: { backgroundColor: "rgba(251,113,133,0.12)", borderLeftWidth: 3, borderLeftColor: theme.danger, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.md },
  errorText: { ...t.caption, color: theme.danger },
  successBox: { backgroundColor: "rgba(52,211,153,0.12)", borderLeftWidth: 3, borderLeftColor: theme.success, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.md },
  successText: { ...t.caption, color: theme.success, fontWeight: "700" },
  actionsRow: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
  note: { ...t.caption, color: theme.textSubtle, lineHeight: 20, marginTop: spacing[2] },
});
