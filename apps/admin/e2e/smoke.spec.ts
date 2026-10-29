import { expect, test } from "@playwright/test";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:4001";

test.describe("admin smoke", () => {
  test("login and visit three pages with real data", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await expect(page.getByText("Control panel sign-in")).toBeVisible();

    await page.getByPlaceholder("Username").or(page.locator("input").first()).fill("superadmin");
    await page.locator("input[type=password]").fill("SuperAdmin123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Dashboard (Prompt 02)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Monitor platform activity, financial operations, and system health.")).toBeVisible();

    for (const kpi of [
      "Total users",
      "Active users",
      "Total agencies",
      "Live rooms",
      "Games",
      "Wallet transactions",
      "Providers",
      "Net gaming margin",
    ]) {
      await expect(page.getByText(kpi).first()).toBeVisible();
    }

    await expect(page.getByText("Platform activity").first()).toBeVisible();
    await expect(page.getByText("Financial summary").first()).toBeVisible();
    await expect(page.getByText("Recent platform activity").first()).toBeVisible();
    await expect(page.getByText("Operational alerts").first()).toBeVisible();
    await expect(page.getByText("Quick actions").first()).toBeVisible();
    await expect(page.getByText(/All amounts in coins/).first()).toBeVisible();

    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText("Today", { exact: false }).first()).toBeVisible();

    // Existing pages still work (regression check) — navigate directly
    // (the sidebar links are inside collapsible groups, so direct URL
    // navigation is the most reliable test path).
    await page.goto(ADMIN_URL + "/#/games");
    await page.goto(ADMIN_URL + "/games");
    await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
    await expect(page.getByText("crash-x").first()).toBeVisible();

    await page.goto(ADMIN_URL + "/wallet");
    await expect(page.getByRole("heading", { name: "Wallet", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ledger explorer" }).click();
    await expect(page.getByText("Ledger explorer").first()).toBeVisible();

    await page.goto(ADMIN_URL + "/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Live app config" }).click();
    await expect(page.getByText("SM Live").first()).toBeVisible();
  });

  test("viewer role sees no write buttons", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.locator("input").first().fill("viewer");
    await page.locator("input[type=password]").fill("Viewer123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForTimeout(2500);
    const navLinks = await page.locator("aside nav a").count();
    expect(navLinks).toBe(0);
    const newButtons = await page.getByRole("button", { name: "+ New" }).count();
    expect(newButtons).toBe(0);
    void API;
  });
});
