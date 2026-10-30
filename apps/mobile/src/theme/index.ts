/**
 * SM Live design system — theme barrel (Prompt 13).
 *
 * Re-exports the palette + typography + spacing so screens import from a
 * single entry point:
 *
 *   import { theme, t, spacing, radius } from "../src/theme";
 *
 * Keeping the barrel small means the design system is easy to discover
 * and hard to use wrong — there is exactly one path to each token.
 */
export { theme, light, dark, withBrand, type Palette } from "./colors";
export { typography, t, textStyle, type TypographyKey, type TypographyToken } from "./typography";
export { spacing, radius, controlHeights, type Spacing, type Radius } from "./spacing";
