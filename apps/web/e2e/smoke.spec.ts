import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScrollAt320And200, expectOnePrimary } from "./support";

/**
 * Гость и служебные экраны без входа: стартовый экран (минимализм — фото, заголовок, одна главная кнопка и «Войти»),
 * вход в установку приложения и витрина компонентов (демо-режим). Данные не меняются.
 */

const INSTALL = "Установить приложение";

test("главная открывается", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("гость: на главной фото, заголовок, одна главная кнопка и «Войти»", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Мебель на заказ, деньги в банке до приёмки" })).toBeVisible();
  await expectOnePrimary(page);
  await expect(main.locator("[data-primary-action]")).toHaveText("Оставить заявку");
  await expect(main.getByRole("link", { name: "Войти", exact: true })).toBeVisible();
  // Несколько фото, а не лента: стартовый экран остаётся коротким.
  const photos = await main.locator("img").count();
  expect(photos).toBeGreaterThanOrEqual(3);
  expect(photos).toBeLessThanOrEqual(6);
  await expectNoHorizontalScrollAt320And200(page, "/");
});

/**
 * Chrome присылает beforeinstallprompt сам, когда сайт можно установить; в тестовом браузере его нет — шлём событие
 * сами, пока страница не подписалась на него (после гидратации) и не показала предложение.
 */
async function offerInstall(page: Page, shown: Locator): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => {
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "dismissed" as const }),
      });
      window.dispatchEvent(event);
    });
    await expect(shown).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

test("гость видит «Установить приложение»: на главной — плашка, на других страницах — пункт в шапке", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  const banner = page.getByRole("region", { name: /на экране телефона$/ });
  await offerInstall(page, banner.getByRole("button", { name: INSTALL, exact: true }));
  // Пока плашка на экране, пункт в шапке не дублирует её.
  await expect(page.getByRole("banner").getByRole("button", { name: INSTALL, exact: true })).toHaveCount(0);

  await page.goto("/catalog");
  await offerInstall(page, page.getByRole("banner").getByRole("button", { name: INSTALL, exact: true }));
});

test("витрина компонентов: новые компоненты на месте, без прокрутки вбок на 320 px и 200 %", async ({ page }) => {
  await page.goto("/ui-kit");
  const main = page.getByRole("main");
  for (const section of [
    "Плитки категорий, плашка, «метка — значение», сводка, чипы-ссылки",
    "Карточки работы и заявки, ход сделки, расчёт мастера, подпись, полноэкранный шаг",
    "Экран деталей в две колонки",
  ]) {
    await expect(main.getByRole("heading", { level: 2, name: section })).toBeVisible();
  }
  await expectNoHorizontalScrollAt320And200(page, "/ui-kit");
});
