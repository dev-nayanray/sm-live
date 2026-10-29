import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { LiveVoice } from "./pages/LiveVoice";
import { UsersAgencies } from "./pages/UsersAgencies";
import { Games } from "./pages/Games";
import { RoundsBets } from "./pages/RoundsBets";
import { Wallet } from "./pages/Wallet";
import { Players } from "./pages/Players";
import { Reports } from "./pages/Reports";
import { ProvidersSettlement } from "./pages/ProvidersSettlement";
import { Security } from "./pages/Security";
import { Settings } from "./pages/Settings";
import "./index.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Shell() {
  const { admin } = useAuth();
  if (!admin) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/live" element={<LiveVoice />} />
        <Route path="/users" element={<UsersAgencies />} />
        <Route path="/games" element={<Games />} />
        <Route path="/rounds" element={<RoundsBets />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/players" element={<Players />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/providers" element={<ProvidersSettlement />} />
        <Route path="/security" element={<Security />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
