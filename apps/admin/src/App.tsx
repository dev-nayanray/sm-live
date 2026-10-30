import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { LiveVoice } from "./pages/LiveVoice";
import { LiveRooms } from "./pages/LiveRooms";
import { RoomDetail } from "./pages/RoomDetail";
import { UsersAgencies } from "./pages/UsersAgencies";
import { UserDetail } from "./pages/UserDetail";
import { Agencies } from "./pages/Agencies";
import { AgencyDetail } from "./pages/AgencyDetail";
import { Games } from "./pages/Games";
import { GameManagement } from "./pages/GameManagement";
import { ProviderManagement } from "./pages/ProviderManagement";
import { GameSessions } from "./pages/GameSessions";
import { RoundsBets } from "./pages/RoundsBets";
import { Wallet } from "./pages/Wallet";
import { Players } from "./pages/Players";
import { Reports } from "./pages/Reports";
import { ProvidersSettlement } from "./pages/ProvidersSettlement";
import { Security } from "./pages/Security";
import { Settings } from "./pages/Settings";
import { AccessDenied } from "./pages/AccessDenied";
import { NotFound } from "./pages/NotFound";
import "./index.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

/**
 * Permission gate wrapping each protected route.
 *
 * The backend independently enforces permissions on every /v1/admin/* route
 * via `requireAdmin(req, perm)` (apps/api/src/lib/auth.ts), so even if a user
 * navigates directly to a URL we hide from the sidebar, the data fetch will
 * return 403. This gate just gives a graceful in-app message instead of an
 * empty broken page.
 */
function RequirePerm({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <AccessDenied perm={perm} />;
  return <>{children}</>;
}

function Shell() {
  const { admin } = useAuth();
  const location = useLocation();
  if (!admin) return <Login />;
  return (
    <Layout>
      <Routes>
        {/* Root → Dashboard (preserved) */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Existing pages, kept on their original paths to avoid breaking
            bookmarks, e2e selectors and the smoke test. */}
        <Route path="/dashboard" element={<RequirePerm perm="dashboard.view"><Dashboard /></RequirePerm>} />
        <Route path="/live" element={<RequirePerm perm="rooms.read"><LiveRooms /></RequirePerm>} />
        <Route path="/live/:id" element={<RequirePerm perm="rooms.read"><RoomDetail /></RequirePerm>} />
        <Route path="/live-content" element={<RequirePerm perm="rooms.read"><LiveVoice /></RequirePerm>} />
        <Route path="/users" element={<RequirePerm perm="users.read"><UsersAgencies /></RequirePerm>} />
        <Route path="/users/:id" element={<RequirePerm perm="users.read"><UserDetail /></RequirePerm>} />
        <Route path="/agencies" element={<RequirePerm perm="agencies.read"><Agencies /></RequirePerm>} />
        <Route path="/agencies/:id" element={<RequirePerm perm="agencies.read"><AgencyDetail /></RequirePerm>} />
        <Route path="/games" element={<RequirePerm perm="games.read"><GameManagement /></RequirePerm>} />
        <Route path="/games-content" element={<RequirePerm perm="games.read"><Games /></RequirePerm>} />
        <Route path="/game-sessions" element={<RequirePerm perm="rounds.read"><GameSessions /></RequirePerm>} />
        <Route path="/game-providers" element={<RequirePerm perm="providers.read"><ProviderManagement /></RequirePerm>} />
        <Route path="/rounds" element={<RequirePerm perm="rounds.read"><RoundsBets /></RequirePerm>} />
        <Route path="/wallet" element={<RequirePerm perm="wallet.read"><Wallet /></RequirePerm>} />
        <Route path="/players" element={<RequirePerm perm="players.read"><Players /></RequirePerm>} />
        <Route path="/reports" element={<RequirePerm perm="reports.read"><Reports /></RequirePerm>} />
        <Route path="/providers" element={<RequirePerm perm="providers.read"><ProvidersSettlement /></RequirePerm>} />
        <Route path="/security" element={<RequirePerm perm="security.read"><Security /></RequirePerm>} />
        <Route path="/settings" element={<RequirePerm perm="settings.read"><Settings /></RequirePerm>} />

        {/* Unknown admin URLs: a clean not-found state instead of silent redirect. */}
        <Route path="*" element={<NotFound key={location.pathname} />} />
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
