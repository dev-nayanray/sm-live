import { router } from "expo-router";
import { Text } from "react-native";
import { useEffect } from "react";
import { useAuth } from "../src/state/AppProviders";

/** Startup gate: splash → auth check → main tabs or login. */
export default function Startup() {
  const { ready, loggedIn } = useAuth();
  useEffect(() => {
    if (!ready) return;
    if (loggedIn) router.replace("/(tabs)/home");
    else router.replace("/auth/login");
  }, [ready, loggedIn]);
  return <Text style={{ color: "#64748b", marginTop: 200, textAlign: "center" }}>starting…</Text>;
}
