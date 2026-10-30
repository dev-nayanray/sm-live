/**
 * SM Live design system — spacing scale (Prompt 13).
 *
 * A single 4px grid powers every layout decision in the app. Hard-coded
 * numbers in StyleSheet are discouraged; use these tokens so a global
 * spacing tweak doesn't require a sweep through every screen.
 *
 * The grid is intentionally small — 7 steps cover mobile UI:
 *
 *   0  → no gap
 *   1  → 4px  (inline icon spacing)
 *   2  → 8px  (compact list rows)
 *   3  → 12px (default chip / input padding)
 *   4  → 16px (default screen padding, card padding)
 *   5  → 20px (section spacing)
 *   6  → 24px (large screen spacing)
 *   8  → 32px (hero spacing)
 *
 * `radius` mirrors the same idea for corner rounding.
 */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
} as const;

export type Spacing = keyof typeof spacing;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export type Radius = keyof typeof radius;

/** Component heights — keep tap targets ≥ 44pt for accessibility. */
export const controlHeights = {
  input: 48,
  button: 48,
  chip: 32,
  row: 56,
  tab: 56,
} as const;
