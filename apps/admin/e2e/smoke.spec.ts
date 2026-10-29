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

    // dashboard
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Active rooms")).toBeVisible();
    await expect(page.getByText("Revenue (bets−wins)")).toBeVisible();

    // games page (config-driven table)
    await page.getByRole("link", { name: "Games" }).click();
    await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
    await expect(page.getByText("crash-x").first()).toBeVisible();

    // wallet ledger explorer
    await page.getByRole("link", { name: "Wallet" }).click();
    await expect(page.getByRole("heading", { name: "Wallet", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ledger explorer" }).click();
    await expect(page.getByText("Ledger explorer").first()).toBeVisible();

    // settings — live config preview
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Live app config" }).click();
    await expect(page.getByText("SM Live").first()).toBeVisible();
  });

  test("viewer role sees no write buttons", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.locator("input").first().fill("viewer");
    await page.locator("input[type=password]").fill("Viewer123!");
    await page.getByRole("button", { name: /sign in/i }).click();

    // viewer has zero permissions → no nav entries, no write buttons anywhere
    await page.waitForTimeout(2500);
    const navLinks = await page.locator("aside nav a").count();
    expect(navLinks).toBe(0);
    const newButtons = await page.getByRole("button", { name: "+ New" }).count();
    expect(newButtons).toBe(0);
    void API;
  });
});
