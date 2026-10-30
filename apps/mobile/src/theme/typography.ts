/**
 * SM Live design system — typography scale (Prompt 13).
 *
 * Type tokens are intentionally small — six sizes covering every UI need:
 *
 *   display  → splash brand, balance hero
 *   h1       → screen titles
 *   h2       → section headers
 *   body     → primary text
 *   caption  → secondary metadata
 *   micro    → timestamps, counters, footers
 *
 * Weights are explicit per-token because React Native's font weight on
 * Android can render inconsistently when set via the `fontWeight` style
 * prop alone — bundling the weight with the size keeps rendering
 * deterministic across devices.
 *
 * The token objects are spread into a `Text` style; consumers should NOT
 * redeclare `fontSize` / `fontWeight`.
 */
import type { TextStyle } from "react-native";

export interface TypographyToken {
  fontSize: number;
  fontWeight: "400" | "500" | "600" | "700" | "800";
  lineHeight: number;
  letterSpacing?: number;
}

export const typography = {
  display: { fontSize: 36, fontWeight: "800", lineHeight: 42, letterSpacing: 2 } satisfies TypographyToken,
  h1: { fontSize: 22, fontWeight: "800", lineHeight: 28 } satisfies TypographyToken,
  h2: { fontSize: 16, fontWeight: "700", lineHeight: 22 } satisfies TypographyToken,
  body: { fontSize: 15, fontWeight: "400", lineHeight: 21 } satisfies TypographyToken,
  caption: { fontSize: 13, fontWeight: "500", lineHeight: 18 } satisfies TypographyToken,
  micro: { fontSize: 11, fontWeight: "600", lineHeight: 14, letterSpacing: 0.5 } satisfies TypographyToken,
} as const;

export type TypographyKey = keyof typeof typography;

/** Convenience: spread into a `Text` style. e.g. `<Text style={[t.h2, { color: theme.text }]}>` */
export const t = typography;

/** Helper for screens that want a TextStyle object directly. */
export function textStyle(key: TypographyKey): TextStyle {
  return typography[key];
}
