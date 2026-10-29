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
        to: "/players",
        label: "Players & Restrictions",
        perm: "players.read",
        icon: "shield",
        hint: "Player restriction records (ban / mute / freeze / kick).",
      },
      {
        to: null,
        label: "Account Restrictions",
        perm: "players.read",
        icon: "lock",
        planned: true,
        hint: "Dedicated restriction console — planned for a later phase.",
      },
      {
        to: null,
        label: "Complaints & Support",
        perm: "users.read",
        icon: "lifebuoy",
        planned: true,
        hint: "Ticketing queue — planned for a later phase.",
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
        label: "Live & Voice Rooms",
        perm: "rooms.read",
        icon: "mic",
        hint: "Monitor live / voice / party rooms (existing page).",
      },
      {
        to: null,
        label: "Content Moderation",
        perm: "rooms.read",
        icon: "eye",
        planned: true,
        hint: "Moderation queue for streams — planned for a later phase.",
      },
      {
        to: null,
        label: "Gifts & Virtual Items",
        perm: "settings.read",
        icon: "gift",
        planned: true,
        hint: "Gift catalogue editor — planned for a later phase (today: Settings → Brand).",
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
        label: "Games",
        perm: "games.read",
        icon: "joystick",
        hint: "Game catalogue, provider binding, status (existing page).",
      },
      {
        to: "/rounds",
        label: "Sessions & History",
        perm: "rounds.read",
        icon: "history",
        hint: "Rounds, bets, settlements & recovery (existing page).",
      },
      {
        to: null,
        label: "Game Providers",
        perm: "providers.read",
        icon: "plug",
        planned: true,
        hint: "Provider catalogue — planned for a later phase (today: Providers & Settlement).",
      },
      {
        to: null,
        label: "Availability & Maintenance",
        perm: "games.read",
        icon: "wrench",
        planned: true,
        hint: "Maintenance windows & availability matrix — planned for a later phase.",
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
        hint: "Ledger explorer, recharges, refunds, adjustments (existing page).",
      },
      {
        to: null,
        label: "Coin Transactions",
        perm: "wallet.read",
        icon: "coins",
        planned: true,
        hint: "Per-user coin movement explorer — planned for a later phase (today: Wallet → Ledger).",
      },
      {
        to: null,
        label: "Refund Records",
        perm: "wallet.read",
        icon: "undo",
        planned: true,
        hint: "Refund ledger filter — planned for a later phase (today: Wallet → Refunds).",
      },
      {
        to: null,
        label: "Payout Configuration",
        perm: "wallet.write",
        icon: "gear",
        planned: true,
        hint: "Payout rules — planned for a later phase.",
      },
      {
        to: null,
        label: "Financial Reports",
        perm: "reports.read",
        icon: "doc",
        planned: true,
        hint: "Finance reporting console — planned for a later phase (today: Reports).",
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
        hint: "Game performance + revenue charts (existing page).",
      },
      {
        to: null,
        label: "User Activity Reports",
        perm: "reports.read",
        icon: "activity",
        planned: true,
        hint: "User activity breakdowns — planned for a later phase.",
      },
      {
        to: null,
        label: "Game Performance",
        perm: "reports.read",
        icon: "spark",
        planned: true,
        hint: "Per-game KPIs — planned for a later phase (today: Reports → Game performance).",
      },
      {
        to: null,
        label: "Revenue Reports",
        perm: "reports.read",
        icon: "trend",
        planned: true,
        hint: "Revenue breakdowns — planned for a later phase (today: Reports → Revenue).",
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
        to: null,
        label: "API Integration",
        perm: "providers.read",
        icon: "code",
        planned: true,
        hint: "Provider integration console — planned for a later phase.",
      },
      {
        to: null,
        label: "Webhook Monitoring",
        perm: "providers.read",
        icon: "webhook",
        planned: true,
        hint: "Webhook logs — planned for a later phase.",
      },
      {
        to: null,
        label: "API Error Logs",
        perm: "security.read",
        icon: "alert",
        planned: true,
        hint: "API error feed — planned for a later phase (today: API & Security → API errors).",
      },
      {
        to: null,
        label: "Sandbox & Live Status",
        perm: "providers.read",
        icon: "beaker",
        planned: true,
        hint: "Environment switch & status — planned for a later phase.",
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
        to: null,
        label: "Administrator Management",
        perm: "security.read",
        icon: "id",
        planned: true,
        hint: "Dedicated admin user console — planned for a later phase (today: API & Security → Roles).",
      },
      {
        to: null,
        label: "Roles & Permissions",
        perm: "security.read",
        icon: "key",
        planned: true,
        hint: "Dedicated role editor — planned for a later phase (today: API & Security → Roles).",
      },
      {
        to: null,
        label: "Audit Logs",
        perm: "security.read",
        icon: "scroll",
        planned: true,
        hint: "Audit-only view — planned for a later phase (today: API & Security → Audit trail).",
      },
      {
        to: null,
        label: "Security Events",
        perm: "security.read",
        icon: "alert",
        planned: true,
        hint: "Security event feed — planned for a later phase (today: API & Security → Security log).",
      },
      {
        to: null,
        label: "IP Access Restrictions",
        perm: "security.read",
        icon: "ip",
        planned: true,
        hint: "IP allow-list console — planned for a later phase (today: API & Security → API keys).",
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
        to: null,
        label: "Notification Management",
        perm: "settings.read",
        icon: "bell",
        planned: true,
        hint: "Notification centre — planned for a later phase.",
      },
      {
        to: null,
        label: "Platform Status",
        perm: "security.read",
        icon: "pulse",
        planned: true,
        hint: "Health board — planned for a later phase (today: API & Security → Server status).",
      },
      {
        to: null,
        label: "Maintenance Configuration",
        perm: "settings.write",
        icon: "wrench",
        planned: true,
        hint: "Maintenance windows — planned for a later phase.",
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
