import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";

/**
 * Гость в новом интерфейсе: главная -> каталог -> фильтр по типу -> работа -> профиль мастера -> «Назад» в список мастеров ->
 * браузерный «Назад» в каталог ->
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

  // Фильтр по типу — первый, у которого есть работы (в навигации фильтров: чипы на телефоне, список слева на компьютере).
  // Тип на карточке не пишется (аудит, guest-23): работу ищем перебором фильтров.
  const typeNav = page.getByRole("navigation", { name: catalog.typeLabel });
  await typeNav.getByRole("link", { name: catalog.allTypes }).waitFor();
  const typeNames = (await typeNav.getByRole("link").allInnerTexts()).map((text) => text.trim()).filter((text) => text !== catalog.allTypes);
  let typeName: string | undefined;
  for (const name of typeNames) {
    await typeNav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/v2\/catalog\?.*type=/);
    await expect(typeNav.locator('[aria-current="true"]')).toContainText(name);
    if ((await page.getByRole("article").count()) > 0) {
      typeName = name;
      break;
    }
  }
  expect(typeName, "есть фильтр по типу с работами").toBeTruthy();
  await expect(typeNav.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(page.getByRole("article").first()).toBeVisible();
  await expectScreenRules(page);

  // Работа -> профиль мастера.
  await page.getByRole("article").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/v2\/executors\/\d+$/);
  await expect(page.getByRole("heading", { level: 2, name: executor.aboutTitle })).toBeVisible();
  await expectScreenRules(page);
  await expect(page.getByRole("link", { name: executor.action })).toHaveCount(1);
  await expect(page.getByRole("link", { name: executor.action })).toHaveAttribute("href", /\/v2\/requests\/new\?executor=\d+$/);

  // «Назад» со страницы мастера — в общий список мастеров (спека 2026-11-17, 3.1); браузерный «Назад» оттуда — снова к мастеру,
  // затем в каталог с фильтром по типу на месте.
  await page.getByRole("link", { name: `${ru.app.kit.back}: ${executor.backLabel}` }).click();
  await expect(page).toHaveURL(/\/v2\/executors$/);
  await expect(page.getByRole("heading", { level: 1, name: ru.app.guest.executors.title })).toBeVisible();
  await expectScreenRules(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/v2\/executors\/\d+$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/v2\/catalog\?.*type=/);
  await expect(typeNav.getByRole("link", { name: typeName ?? "", exact: true })).toHaveAttribute("aria-current", "true");
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
