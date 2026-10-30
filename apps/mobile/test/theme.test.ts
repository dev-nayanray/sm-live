import { dark, light, theme, withBrand } from "../src/theme/colors";

/**
 * Theme palette (Prompt 13).
 *
 * Tests cover:
 *   - The palette ships every key used by the components barrel.
 *   - Brand overrides only affect `primary` / `primaryMuted` / `accent`;
 *     structural tokens (bg, surface, success, danger, etc.) stay constant.
 *   - `withBrand` defends against malformed brand payloads (empty strings,
 *     invalid hex) — it falls back to the seed theme rather than crash.
 */

describe("theme palette", () => {
  it("ships every token the components barrel reads", () => {
    const required = [
      "bg", "surface", "surfaceAlt", "border",
      "text", "textMuted", "textSubtle", "textInverse",
      "primary", "primaryMuted", "accent",
      "success", "warning", "danger", "info",
      "vip", "noble",
    ] as const;
    for (const key of required) {
      expect(theme[key]).toBeTruthy();
      expect(typeof theme[key]).toBe("string");
      expect(theme[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("dark + light palettes share the same key set", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("withBrand overrides primary + accent only", () => {
    const branded = withBrand({ primaryColor: "#ff0000", accentColor: "#00ff00" });
    expect(branded.primary).toBe("#ff0000");
    expect(branded.accent).toBe("#00ff00");
    // structural tokens preserved
    expect(branded.bg).toBe(theme.bg);
    expect(branded.surface).toBe(theme.surface);
    expect(branded.success).toBe(theme.success);
    expect(branded.danger).toBe(theme.danger);
    expect(branded.vip).toBe(theme.vip);
  });

  it("withBrand falls back to seed when brand color is empty", () => {
    const branded = withBrand({ primaryColor: "", accentColor: "" });
    expect(branded.primary).toBe(theme.primary);
    expect(branded.accent).toBe(theme.accent);
  });

  it("withBrand falls back to seed when brand color is malformed", () => {
    const branded = withBrand({ primaryColor: "not-a-hex", accentColor: "#xyz" });
    expect(branded.primary).toBe(theme.primary);
    expect(branded.accent).toBe(theme.accent);
  });

  it("withBrand does not mutate the seed theme (returns a new object)", () => {
    const before = { ...theme };
    withBrand({ primaryColor: "#abcdef" });
    expect(theme).toEqual(before);
  });

  it("primaryMuted is a lightened variant of primary after brand override", () => {
    const branded = withBrand({ primaryColor: "#000000" });
    // black mixed with 30% white should produce roughly #4d4d4d (allowing
    // for rounding)
    const m = /^#([0-9a-f]{6})$/i.exec(branded.primaryMuted);
    expect(m).not.toBeNull();
    const n = parseInt(m![1]!, 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    // 30% white on #000000 ≈ rgb(76, 76, 76) — allow ±2 for rounding
    expect(r).toBeGreaterThanOrEqual(74);
    expect(r).toBeLessThanOrEqual(78);
    expect(g).toBeGreaterThanOrEqual(74);
    expect(g).toBeLessThanOrEqual(78);
    expect(b).toBeGreaterThanOrEqual(74);
    expect(b).toBeLessThanOrEqual(78);
  });
});
