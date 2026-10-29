import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.ADMIN_URL ?? "http://localhost:5173",
    headless: true,
  },
  reporter: [["list"]],
});
