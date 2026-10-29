import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";

export default function Register() {
  const { config } = useAppConfig();
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await register({ phone: phone.trim(), password, displayName: displayName.trim() });
      router.replace("/(tabs)/home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <Text style={s.brand}>join {config.brand.appName}</Text>
      <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholder="display name" placeholderTextColor="#475569" />
      <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="phone (+8801…)" placeholderTextColor="#475569" keyboardType="phone-pad" autoCapitalize="none" />
      <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="password (min 6)" placeholderTextColor="#475569" secureTextEntry />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable style={s.button} onPress={submit} disabled={busy || !displayName || !phone || password.length < 6}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Create account</Text>}
      </Pressable>
      <Pressable style={s.ghost} onPress={() => router.back()}>
        <Text style={s.ghostText}>← back to sign in</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 28, justifyContent: "center" },
  brand: { color: "#f8fafc", fontSize: 22, fontWeight: "700", marginBottom: 24, textAlign: "center" },
  input: { backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#7c3aed", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontWeight: "700" },
  ghost: { marginTop: 16, alignItems: "center" },
  ghostText: { color: "#94a3b8" },
  error: { color: "#fb7185", marginBottom: 10 },
});
