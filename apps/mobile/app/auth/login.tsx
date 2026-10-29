import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useAppConfig, useAuth } from "../../src/state/AppProviders";
import { api } from "../../src/api/client";

export default function Login() {
  const { config } = useAppConfig();
  const { login, otpLogin } = useAuth();
  const [identifier, setIdentifier] = useState("+880170000001");
  const [password, setPassword] = useState("User123!");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.replace("/(tabs)/home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!otpSent) {
        const res = await api<{ devCode: string }>("/v1/auth/otp/request", { method: "POST", json: { identifier: identifier.trim() } });
        setDevCode(res.devCode);
        setOtpSent(true);
      } else {
        await otpLogin(identifier.trim(), otp.trim());
        router.replace("/(tabs)/home");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <Text style={s.brand}>{config.brand.appName}</Text>
      <Text style={s.sub}>sign in to continue</Text>

      <TextInput style={s.input} value={identifier} onChangeText={setIdentifier}
        placeholder="phone or email" placeholderTextColor="#475569" autoCapitalize="none" />
      {!otpSent ? (
        <TextInput style={s.input} value={password} onChangeText={setPassword}
          placeholder="password" placeholderTextColor="#475569" secureTextEntry />
      ) : (
        <>
          <TextInput style={s.input} value={otp} onChangeText={setOtp}
            placeholder="6-digit code" placeholderTextColor="#475569" keyboardType="number-pad" />
          {devCode && <Text style={s.devCode}>dev OTP: {devCode}</Text>}
        </>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <Pressable style={s.button} onPress={otpSent ? doOtp : doLogin} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{otpSent ? "Verify OTP" : "Sign in"}</Text>}
      </Pressable>
      <Pressable style={s.ghost} onPress={doOtp}>
        <Text style={s.ghostText}>{otpSent ? "resend code" : "use OTP instead"}</Text>
      </Pressable>
      <Pressable style={s.ghost} onPress={() => router.push("/auth/register")}>
        <Text style={s.ghostText}>create an account →</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 28, justifyContent: "center" },
  brand: { color: "#a78bfa", fontSize: 36, fontWeight: "800", textAlign: "center", letterSpacing: 2 },
  sub: { color: "#64748b", textAlign: "center", marginBottom: 32 },
  input: { backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: "#7c3aed", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  ghost: { marginTop: 16, alignItems: "center" },
  ghostText: { color: "#94a3b8" },
  devCode: { color: "#34d399", marginBottom: 8, fontSize: 12 },
  error: { color: "#fb7185", marginBottom: 10 },
});
