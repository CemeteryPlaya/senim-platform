import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";

/**
 * Гость в новом интерфейсе: главная -> каталог -> фильтр по типу -> работа -> профиль мастера -> назад в каталог ->
 * «О сервисе». Данных не меняет. Подписи — только из ru; на каждом экране ровно один h1 и не больше одного главного действия.
 */

const shell = ru.app.shell;
const catalog = ru.app.guest.catalog;
const executor = ru.app.guest.executor;

/** Ровно один `<h1>` и не больше одного главного действия на экране. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
}

test("гость: главная, каталог с фильтром, работа, профиль мастера, назад, «О сервисе»", async ({ page }) => {
  const menu = page.getByRole("navigation", { name: shell.navLabel });

  await page.goto("/v2");
  await expectScreenRules(page);

  // Каталог — из меню.
  await menu.getByRole("link", { name: shell.nav.masters }).click();
  await expect(page).toHaveURL(/\/v2\/catalog$/);
  await expect(page.getByRole("heading", { level: 1, name: catalog.title })).toBeVisible();
  await expectScreenRules(page);

  // Фильтр по типу: первый тип после «Все типы».
  const typeChips = page.getByRole("navigation", { name: catalog.typeLabel });
  await typeChips.getByRole("link", { name: catalog.allTypes }).waitFor();
  const firstType = typeChips.getByRole("link").filter({ hasNotText: catalog.allTypes }).first();
  await firstType.click();
  await expect(page).toHaveURL(/\/v2\/catalog\?.*type=/);
  await expect(typeChips.locator('[aria-current="true"]')).toHaveCount(1);
  await expectScreenRules(page);

  // Работа -> профиль мастера.
  await page.getByRole("article").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/v2\/executors\/\d+$/);
  await expect(page.getByRole("heading", { level: 2, name: executor.aboutTitle })).toBeVisible();
  await expectScreenRules(page);
  await expect(page.getByRole("link", { name: executor.action })).toHaveCount(1);

  // Назад на каталог.
  await page.getByRole("link", { name: `${ru.app.kit.back}: ${executor.backLabel}` }).click();
  await expect(page).toHaveURL(/\/v2\/catalog$/);
  await expectScreenRules(page);

  // «О сервисе».
  await menu.getByRole("link", { name: shell.nav.about }).click();
  await expect(page).toHaveURL(/\/v2\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: ru.app.guest.about.title })).toBeVisible();
  await expectScreenRules(page);
});

test("профиль мастера: неизвестный номер — страница «не найдена»", async ({ page }) => {
  await page.goto("/v2/executors/999999999");
  await expect(page.getByRole("heading", { level: 1, name: shell.notFoundTitle })).toBeVisible();
  await expectScreenRules(page);
});
