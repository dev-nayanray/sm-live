import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The dashboard test exercises 4 pages (Dashboard + Games + Wallet + Settings)
  // and waits for real API data on each, so give it generous headroom.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: process.env.ADMIN_URL ?? "http://localhost:5173",
    headless: true,
    actionTimeout: 15_000,
  },
  reporter: [["list"]],
});
