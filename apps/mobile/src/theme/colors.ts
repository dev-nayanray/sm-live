/**
 * SM Live design system — color palette (Prompt 13).
 *
 * The palette is dark-first (the social app ships dark by default). Light
 * mode values are provided for parity but the app does not currently switch
 * — a later prompt can add a theme toggle that flips these tokens.
 *
 * Brand colors come from the live `BrandConfig` returned by
 * GET /v1/config/app. The values here are the seed defaults used by the
 * splash screen + login screen BEFORE the brand config has loaded; once
 * the config arrives, the screens should read from `useAppConfig()` and
 * override `primary` / `accent`.
 *
 * Names mirror the admin Tailwind palette so a designer moving between
 * the admin web UI and the mobile app sees the same vocabulary.
 */

export interface Palette {
  // --- surfaces ---
  bg: string;          // app background
  surface: string;     // cards, sheets
  surfaceAlt: string;  // chips, input fills
  border: string;      // hairlines
  // --- text ---
  text: string;        // primary
  textMuted: string;   // secondary
  textSubtle: string;  // tertiary / captions
  textInverse: string; // on primary / accent fills
  // --- brand ---
  primary: string;     // brand purple (default)
  primaryMuted: string;
  accent: string;      // brand rose (default)
  // --- semantic ---
  success: string;
  warning: string;
  danger: string;
  info: string;
  // --- vip / noble ---
  vip: string;         // gold
  noble: string;       // royal purple
}

export const dark: Palette = {
  bg: "#0f172a",
  surface: "#1e293b",
  surfaceAlt: "#0f172a",
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  textSubtle: "#64748b",
  textInverse: "#ffffff",
  primary: "#7c3aed",
  primaryMuted: "#a78bfa",
  accent: "#f43f5e",
  success: "#34d399",
  warning: "#f59e0b",
  danger: "#fb7185",
  info: "#38bdf8",
  vip: "#fbbf24",
  noble: "#c084fc",
};

export const light: Palette = {
  bg: "#f8fafc",
  surface: "#ffffff",
  surfaceAlt: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#475569",
  textSubtle: "#94a3b8",
  textInverse: "#ffffff",
  primary: "#7c3aed",
  primaryMuted: "#a78bfa",
  accent: "#f43f5e",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#e11d48",
  info: "#0284c7",
  vip: "#f59e0b",
  noble: "#9333ea",
};

/** Default theme — dark-first social app. */
export const theme: Palette = dark;

/**
 * Override brand tokens with values from the live BrandConfig. Returns a
 * new palette so the seed theme is never mutated — important for the
 * splash screen which renders before the config arrives.
 *
 * Only `primary` and `accent` are overridden; the rest of the palette is
 * structural and must not change with the brand.
 *
 * Validates each brand color against the `#RRGGBB` hex pattern — invalid
 * or empty values fall back to the seed color so a malformed BrandConfig
 * row can never produce an unparseable color.
 */
export function withBrand(brand: { primaryColor?: string; accentColor?: string }): Palette {
  const primary = isValidHex(brand.primaryColor) ? brand.primaryColor! : theme.primary;
  const accent = isValidHex(brand.accentColor) ? brand.accentColor! : theme.accent;
  return {
    ...theme,
    primary,
    primaryMuted: shade(primary, 30),
    accent,
  };
}

/** Validate a `#RRGGBB` hex color. Returns false for any other shape. */
function isValidHex(s: string | undefined | null): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

/** Lighten a hex color by mixing it with white. Returns the original on parse failure. */
function shade(hex: string, mix: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const mixed = (c: number) => Math.round(c + (255 - c) * (mix / 100));
  const out = (mixed(r) << 16) | (mixed(g) << 8) | mixed(b);
  return `#${out.toString(16).padStart(6, "0")}`;
}
