/**
 * SM Live — Super Admin navigation configuration.
 *
 * Single source of truth for the sidebar + breadcrumbs. Grouped to match the
 * proposed 9-section information architecture from Prompt 01, but reconciled
 * against the actually-existing routes & backend permission keys.
 *
 * Reuse rules:
 *   - `to` MUST point at an existing route declared in App.tsx.
 *   - Items with `planned: true` are NOT yet implemented. They render as
 *     disabled links with a "planned" tooltip so admins see the roadmap
 *     without reaching a fake/nonfunctional page.
 *   - `perm` MUST be one of {@link import("@sm-live/shared").PERMISSIONS}.
 *     Items the current admin cannot read are filtered out client-side; the
 *     backend still enforces the same permission on the API route.
 */

export interface NavLeaf {
  /** Existing route path (must exist in App.tsx), or null when planned. */
  to: string | null;
  label: string;
  /** Permission key (one of PERMISSIONS in @sm-live/shared). */
  perm: string;
  /** Icon name — resolved by the Icon component. */
  icon: string;
  /** Marks modules not yet implemented. Renders as disabled with a badge. */
  planned?: boolean;
  /** Optional short description shown in tooltip / mobile drawer. */
  hint?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  /** Permission gate that applies to the whole group. */
  perm: string;
  items: NavLeaf[];
}

/**
 * The full Super Admin menu tree. Editing this array is the ONLY change needed
 * to extend the sidebar in future phases.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "gauge",
    perm: "dashboard.view",
    items: [
      {
        to: "/dashboard",
        label: "Dashboard",
        perm: "dashboard.view",
        icon: "chart",
        hint: "Platform-wide KPIs, 30-day series and API error counter.",
      },
    ],
  },
  {
    id: "user-ops",
    label: "User Operations",
    icon: "users",
    perm: "users.read",
    items: [
      {
        to: "/users",
        label: "Users & Agencies",
        perm: "users.read",
        icon: "users",
        hint: "User accounts, agency onboarding and agency admins (existing page).",
      },
      {
        to: "/agencies",
        label: "Agencies",
        perm: "agencies.read",
        icon: "users",
        hint: "Manage agencies, agency admins, member assignments and status.",
      },
      {
        to: "/players",
        label: "Players & Restrictions",
        perm: "players.read",
        icon: "shield",
        hint: "Player restriction records (ban / mute / freeze / kick).",
      },
      {
        to: "/account-restrictions",
        label: "Account Restrictions",
        perm: "players.read",
        icon: "lock",
        hint: "Dedicated restriction console over every ban / mute / freeze / kick.",
      },
      {
        to: "/complaints-support",
        label: "Complaints & Support",
        perm: "users.read",
        icon: "lifebuoy",
        hint: "Unified complaint + support-ticket queue with agent actions.",
      },
    ],
  },
  {
    id: "live",
    label: "Live Platform",
    icon: "broadcast",
    perm: "rooms.read",
    items: [
      {
        to: "/live",
        label: "Live Room Monitoring",
        perm: "rooms.read",
        icon: "mic",
        hint: "Monitor live / voice / party rooms, participants, reports, and moderation actions.",
      },
      {
        to: "/content-moderation",
        label: "Content Moderation",
        perm: "rooms.read",
        icon: "eye",
        hint: "Room report review queue and suspicious activity signals.",
      },
      {
        to: "/gifts",
        label: "Gifts & Virtual Items",
        perm: "settings.read",
        icon: "gift",
        hint: "Gift catalogue editor with gifting volume stats.",
      },
    ],
  },
  {
    id: "games",
    label: "Game Operations",
    icon: "joystick",
    perm: "games.read",
    items: [
      {
        to: "/games",
        label: "Game Management",
        perm: "games.read",
        icon: "joystick",
        hint: "Manage game catalog, availability, and maintenance status.",
      },
      {
        to: "/game-sessions",
        label: "Game Sessions",
        perm: "rounds.read",
        icon: "history",
        hint: "Monitor active and historical game launch sessions.",
      },
      {
        to: "/rounds",
        label: "Rounds & Bets",
        perm: "rounds.read",
        icon: "history",
        hint: "Rounds, bets, settlements & recovery (existing page).",
      },
      {
        to: "/game-providers",
        label: "Game Providers",
        perm: "providers.read",
        icon: "plug",
        hint: "Manage provider integrations, monitor health, and review API errors.",
      },
      {
        to: "/availability",
        label: "Availability & Maintenance",
        perm: "games.read",
        icon: "wrench",
        hint: "Per-game status control + maintenance windows.",
      },
    ],
  },
  {
    id: "wallet",
    label: "Wallet & Finance",
    icon: "wallet",
    perm: "wallet.read",
    items: [
      {
        to: "/wallet",
        label: "Wallet Overview",
        perm: "wallet.read",
        icon: "wallet",
        hint: "Financial dashboard, wallets, transactions, recharges, refunds, reconciliation.",
      },
      {
        to: "/wallet",
        label: "Coin Transactions",
        perm: "wallet.read",
        icon: "coins",
        hint: "Ledger explorer with kind/user/date/amount filters + CSV export.",
      },
      {
        to: "/refunds",
        label: "Refund Records",
        perm: "wallet.read",
        icon: "undo",
        hint: "Refund ledger with source recharge and issuing admin.",
      },
      {
        to: "/payout-config",
        label: "Payout Configuration",
        perm: "wallet.write",
        icon: "gear",
        hint: "Per-game payout rules and realised RTP.",
      },
      {
        to: "/financial-reports",
        label: "Financial Reports",
        perm: "reports.read",
        icon: "doc",
        hint: "Financial analytics, wallet totals and settlement records.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    icon: "chart",
    perm: "reports.read",
    items: [
      {
        to: "/reports",
        label: "Platform Analytics",
        perm: "reports.read",
        icon: "chart",
        hint: "Overview, user growth, live, games, financial, provider, and system analytics.",
      },
      {
        to: "/user-activity",
        label: "User Activity Reports",
        perm: "reports.read",
        icon: "activity",
        hint: "User growth and activity breakdowns.",
      },
      {
        to: "/game-performance",
        label: "Game Performance",
        perm: "reports.read",
        icon: "spark",
        hint: "Per-game KPIs: bets, outcomes, payouts.",
      },
      {
        to: "/reports/revenue",
        label: "Revenue Reports",
        perm: "reports.read",
        icon: "trend",
        hint: "Revenue breakdowns by source.",
      },
    ],
  },
  {
    id: "providers",
    label: "Provider Integration",
    icon: "plug",
    perm: "providers.read",
    items: [
      {
        to: "/providers",
        label: "Providers & Settlement",
        perm: "providers.read",
        icon: "plug",
        hint: "Game providers, settlement records (existing page).",
      },
      {
        to: "/api-integration",
        label: "API Integration",
        perm: "providers.read",
        icon: "code",
        hint: "Provider integration posture: keys, sessions, errors.",
      },
      {
        to: "/webhooks",
        label: "Webhook Monitoring",
        perm: "providers.read",
        icon: "webhook",
        hint: "Webhook-settled rounds feed.",
      },
      {
        to: "/api-errors",
        label: "API Error Logs",
        perm: "security.read",
        icon: "alert",
        hint: "API error log feed with source filters.",
      },
      {
        to: "/sandbox-status",
        label: "Sandbox & Live Status",
        perm: "providers.read",
        icon: "beaker",
        hint: "Provider sandbox vs live modes.",
      },
    ],
  },
  {
    id: "admin-security",
    label: "Administration & Security",
    icon: "shield",
    perm: "security.read",
    items: [
      {
        to: "/security",
        label: "API & Security",
        perm: "security.read",
        icon: "shield",
        hint: "API keys, IP allow lists, security events, audit trail, server status, roles (existing page).",
      },
      {
        to: "/administrators",
        label: "Administrator Management",
        perm: "security.read",
        icon: "id",
        hint: "Admin user accounts and roles.",
      },
      {
        to: "/roles",
        label: "Roles & Permissions",
        perm: "security.read",
        icon: "key",
        hint: "Role editor with permission matrix.",
      },
      {
        to: "/audit-logs",
        label: "Audit Logs",
        perm: "security.read",
        icon: "scroll",
        hint: "Admin audit trail with before/after diffs.",
      },
      {
        to: "/security-events",
        label: "Security Events",
        perm: "security.read",
        icon: "alert",
        hint: "Security event feed with 24h counters.",
      },
      {
        to: "/ip-access",
        label: "IP Access Restrictions",
        perm: "security.read",
        icon: "ip",
        hint: "API access keys and IP allow-lists.",
      },
    ],
  },
  {
    id: "system",
    label: "System Management",
    icon: "gear",
    perm: "settings.read",
    items: [
      {
        to: "/settings",
        label: "System Settings",
        perm: "settings.read",
        icon: "gear",
        hint: "Brand, feature flags, markets, country filters, settings editor (existing page).",
      },
      {
        to: "/notifications",
        label: "Notification Management",
        perm: "settings.read",
        icon: "bell",
        hint: "In-app notification broadcast console.",
      },
      {
        to: "/platform-status",
        label: "Platform Status",
        perm: "security.read",
        icon: "pulse",
        hint: "Live component health board.",
      },
      {
        to: "/maintenance-config",
        label: "Maintenance Configuration",
        perm: "settings.write",
        icon: "wrench",
        hint: "Schedule maintenance windows.",
      },
    ],
  },
  {
    id: "operations",
    label: "Platform Operations",
    icon: "server",
    perm: "ops.view",
    items: [
      {
        to: "/operations",
        label: "Operations Dashboard",
        perm: "ops.view",
        icon: "pulse",
        hint: "Real-time platform health, infrastructure status, maintenance, backups, incidents, alerts, jobs & reports.",
      },
      {
        to: "/operations",
        label: "Health Checks",
        perm: "ops.view",
        icon: "pulse",
        hint: "Component health probes — backend, DB, Redis, providers, wallet, webhooks.",
      },
      {
        to: "/operations",
        label: "Maintenance",
        perm: "ops.maintenance",
        icon: "wrench",
        hint: "Schedule / activate / cancel maintenance windows for the platform or a single module.",
      },
      {
        to: "/operations",
        label: "Backups & Recovery",
        perm: "ops.backups",
        icon: "toolbox",
        hint: "Verified backup history, manual backup triggers, restore workflow with audit trail.",
      },
      {
        to: "/operations",
        label: "Incidents & Alerts",
        perm: "ops.incidents",
        icon: "alert",
        hint: "Operational incidents and system alerts with ack / resolve state machine.",
      },
      {
        to: "/operations",
        label: "System Logs",
        perm: "ops.logs",
        icon: "scroll",
        hint: "Redacted API error logs and full admin audit trail.",
      },
      {
        to: "/operations",
        label: "Background Jobs",
        perm: "ops.jobs",
        icon: "refresh",
        hint: "Live BullMQ queue + scheduled repeat jobs (recover-rounds, daily-rollup, …).",
      },
    ],
  },
];

/**
 * Flatten the tree into the list of routes that actually exist.
 * Used by App.tsx to declare routes & by breadcrumbs to resolve titles.
 */
export const NAV_LEAVES: NavLeaf[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Find the leaf for a given pathname. Returns null for unknown routes.
 * Used by breadcrumbs to render the current page title.
 */
export function findLeaf(pathname: string): NavLeaf | null {
  return NAV_LEAVES.find((l) => l.to === pathname) ?? null;
}

/**
 * Find the group containing a given pathname. Used by the sidebar to keep the
 * parent group expanded when a child is active.
 */
export function findGroupForPath(pathname: string): NavGroup | null {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.to === pathname)) ?? null;
}
