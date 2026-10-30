/**
 * Inline SVG icon set — keeps the bundle small (no extra dependency) and
 * guarantees the icons inherit currentColor so they adapt to dark/light themes.
 *
 * Add a new icon by:
 *   1. Picking a name and adding a 20x20 (viewBox) <path>/<g> in ICON_PATHS.
 *   2. Reference it from navigation.ts via the `icon` field.
 *
 * Usage:  <Icon name="chart" className="h-5 w-5" />
 */
import type { SVGProps } from "react";

const ICON_PATHS: Record<string, JSX.Element> = {
  // --- group / nav icons ---
  gauge: (
    <>
      <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 12 2.5Zm0 17a7.5 7.5 0 1 1 7.5-7.5 7.5 7.5 0 0 1-7.5 7.5Z" />
      <path d="M16.5 8.5 13 11" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  users: (
    <>
      <path d="M16 19a4 4 0 0 0-8 0" />
      <circle cx="12" cy="9" r="3.2" />
      <path d="M3.5 19a5 5 0 0 1 7-4.6" />
      <path d="M16.5 14.4A5 5 0 0 1 20.5 19" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.5 7.5a6.5 6.5 0 0 0 0 9" />
      <path d="M16.5 7.5a6.5 6.5 0 0 1 0 9" />
      <path d="M5 5a10 10 0 0 0 0 14" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  joystick: (
    <>
      <rect x="2" y="11" width="20" height="7" rx="2" />
      <path d="M7 14.5h2M8 13.5v2" />
      <path d="M12 11V7" />
      <circle cx="12" cy="5" r="2" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M16 12h3" />
      <circle cx="16.5" cy="12" r="1" />
      <path d="M3 9h14" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 14l3-3 3 2 4-5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0Z" />
      <path d="M12 16v6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4 5.5v5c0 4.5 3.3 8.3 8 9.5 4.7-1.2 8-5 8-9.5v-5Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H10a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),

  // --- leaf / item icons ---
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4M8 22h8" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.5 6a3.5 3.5 0 0 0-4.6 4.6L3 17.5 6.5 21l6.9-6.9A3.5 3.5 0 0 0 18 9.5l-2 2-2-2 2-2Z" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M14.5 4.5a5 5 0 1 1 0 10" />
      <path d="M14.5 9.5a5 5 0 0 1 0 10" />
      <circle cx="8" cy="14.5" r="5" />
    </>
  ),
  undo: (
    <>
      <path d="M3 7v6h6" />
      <path d="M3.5 13a9 9 0 1 0 2.6-9.1L3 7" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h8" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3 7 4-14 3 7h4" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.5 14 9l6.5 2-6.5 2L12 19.5 10 13l-6.5-2 6.5-2Z" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h6v6" />
    </>
  ),
  code: (
    <>
      <path d="M8 6 2 12l6 6" />
      <path d="M16 6l6 6-6 6" />
    </>
  ),
  webhook: (
    <>
      <path d="M9 4a3 3 0 0 1 1 5.8L7 16a3 3 0 1 1-1-2.8l3-6A3 3 0 0 1 9 4Z" />
      <path d="M15 14a3 3 0 1 1-3 4.2" />
      <path d="M11 9.5 15 14" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2 19h20Z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  beaker: (
    <>
      <path d="M9 3h6M10 3v6l-5 8a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 17l-5-8V3" />
      <path d="M7 14h10" />
    </>
  ),
  id: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="12" r="2" />
      <path d="M14 10h4M14 14h4M6 16.5a3 3 0 0 1 6 0" />
    </>
  ),
  key: (
    <>
      <circle cx="7" cy="14" r="3" />
      <path d="M9 11.5 18 2.5l2 2-2 2 1 1-2 2-1-1-2 2" />
    </>
  ),
  scroll: (
    <>
      <path d="M5 4a2 2 0 0 1 2-2h11v16a2 2 0 0 1-2 2H7a2 2 0 0 0-2 2Z" />
      <path d="M5 4a2 2 0 0 0-2 2v2h4" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>
  ),
  ip: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 9v4M7 9h2M11 9v4M14 9v4M14 9h2v2h-2M17.5 9v4" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15" r="1" />
    </>
  ),
  lifebuoy: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m5 5 4 4M11 11l4-4M11 13l-4 4M13 13l4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="9" width="18" height="11" rx="1" />
      <path d="M3 13h18M12 9v11" />
      <path d="M12 9S10 4 7.5 5C5 6 9 9 12 9Z" />
      <path d="M12 9s2-5 4.5-4C19 6 15 9 12 9Z" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 6 1.5 6H4.5S6 13 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  pulse: (
    <>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </>
  ),
  // --- operations icons (Prompt 12) ---
  server: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  toolbox: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="1.5" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
      <path d="M11 13v2h2v-2" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),

  // --- chrome icons (header / sidebar / footer) ---
  menu: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </>
  ),
  close: (
    <>
      <path d="M6 6 18 18M18 6 6 18" />
    </>
  ),
  chevronDown: (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
  chevronRight: (
    <>
      <path d="M9 6l6 6-6 6" />
    </>
  ),
  chevronLeft: (
    <>
      <path d="M15 6l-6 6 6 6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </>
  ),
  moon: (
    <>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6 6 0 0 0 9.5 9.5Z" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 7l4 5-4 5" />
      <path d="M19 12H9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h3M18 12h3M12 3v3M12 18v3M5 5l2 2M15 15l2 2M5 19l2-2M15 9l2-2" />
    </>
  ),
  check: (
    <>
      <path d="M5 12l5 5L20 7" />
    </>
  ),
  forbidden: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M5.5 5.5 18 18" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
};

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName | string;
}

export function Icon({ name, ...props }: IconProps) {
  const inner = ICON_PATHS[name] ?? ICON_PATHS.compass;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {inner}
    </svg>
  );
}
