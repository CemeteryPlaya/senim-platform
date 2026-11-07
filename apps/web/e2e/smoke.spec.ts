import { expect, test } from "@playwright/test";

test("главная открывается", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
