import { expect, test } from "@playwright/test";
import { loginAs, P } from "./support";

/**
 * Возможности Фазы 2 за флагами (ADR-009, раздел 8) по умолчанию выключены: страниц нет (404), в меню их нет.
 * «Вдохновение» (inspiration), портфолио из сделки (dealPortfolio), публичная витрина сделки (publicShowcase).
 * Данные не меняются.
 */

test("«Вдохновение» выключено: 404 и гостю, и покупателю, в меню нет", async ({ page }) => {
  await page.context().clearCookies();
  for (const path of ["/inspiration", "/inspiration?type=kitchen"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Вдохновение" })).toHaveCount(0);
  }
  await loginAs(page, P.aigerim);
  const res = await page.goto("/inspiration");
  expect(res?.status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Основное меню" }).getByRole("link", { name: "Вдохновение" })).toHaveCount(0);
  // Разделы профиля берутся из той же модели меню: выключенного раздела нет и там.
  await page.goto("/profile");
  const sections = page.getByRole("main").getByRole("navigation", { name: "Разделы" });
  await expect(sections.getByRole("link", { name: "Мои заявки" })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Вдохновение" })).toHaveCount(0);
});

test("публичная витрина сделки выключена: 404", async ({ page }) => {
  const res = await page.request.get("/api/public/deals/any-public-id");
  expect(res.status()).toBe(404);
});
