import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "../src/hooks/settingsStore";

/**
 * Settings store (Prompt 13).
 *
 * The settings store is the persistence layer behind the Settings screen.
 * `mergeSettings` is the only non-trivial function — it has to defend
 * against a malformed cached blob (missing nested objects) so a corrupt
 * cache never crashes the screen on load.
 */

const base: AppSettings = { ...DEFAULT_SETTINGS, updatedAt: 1234 };

describe("settings store", () => {
  it("merges top-level keys", () => {
    const merged = mergeSettings(base, { theme: "light", language: "bn" });
    expect(merged.theme).toBe("light");
    expect(merged.language).toBe("bn");
    // untouched fields preserved
    expect(merged.notifications).toEqual(base.notifications);
    expect(merged.privacy).toEqual(base.privacy);
  });

  it("merges nested notification preferences without losing untouched toggles", () => {
    const merged = mergeSettings(base, { notifications: { newMessages: false } });
    expect(merged.notifications.newMessages).toBe(false);
    // untouched toggles kept
    expect(merged.notifications.liveFromFollowing).toBe(true);
    expect(merged.notifications.giftsReceived).toBe(true);
    expect(merged.notifications.marketing).toBe(false);
  });

  it("merges nested privacy preferences without losing untouched toggles", () => {
    const merged = mergeSettings(base, { privacy: { showOnlineStatus: false } });
    expect(merged.privacy.showOnlineStatus).toBe(false);
    expect(merged.privacy.allowDirectMessages).toBe(true);
  });

  it("defends against a malformed cached blob (missing nested objects)", () => {
    // A bad cache might have stored only top-level keys. The merge MUST
    // fill in the missing nested objects from defaults — never crash with
    // "cannot read property of undefined".
    const merged = mergeSettings(base, { theme: "system" });
    expect(merged.theme).toBe("system");
    expect(merged.notifications).toEqual(DEFAULT_SETTINGS.notifications);
    expect(merged.privacy).toEqual(DEFAULT_SETTINGS.privacy);
  });

  it("preserves the existing updatedAt when the incoming payload omits it", () => {
    const merged = mergeSettings(base, { theme: "dark" });
    expect(merged.updatedAt).toBe(base.updatedAt);
  });

  it("overrides updatedAt when the incoming payload provides it", () => {
    const merged = mergeSettings(base, { updatedAt: 9999 });
    expect(merged.updatedAt).toBe(9999);
  });

  it("defaults match the documented platform behaviour", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark"); // app is dark-first
    expect(DEFAULT_SETTINGS.language).toBe("en"); // english shipped
    expect(DEFAULT_SETTINGS.notifications.marketing).toBe(false); // opt-in marketing
    expect(DEFAULT_SETTINGS.privacy.showOnlineStatus).toBe(true); // social default
    expect(DEFAULT_SETTINGS.privacy.allowDirectMessages).toBe(true); // social default
  });
});
