import { expect, test } from "@playwright/test";
import { expectNoHorizontalScrollAt320And200, expectOnePrimary, loginAs, P, reseed } from "./support";

/**
 * Две роли на одном аккаунте (ADR-004): мастер «Дала» (Исп. №4) заказывал шкаф как покупатель (сделка №17).
 * В «Сделках» видны сделки обеих ролей с пометкой; сделка другой роли открывается через страницу
 * переключения роли, после переключения — сама сделка.
 */

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("сделка в роли покупателя открывается после переключения роли", async ({ page }) => {
  await loginAs(page, P.dala);
  await expect(page).toHaveURL(/\/executor\/requests$/);

  await page.goto("/deals");
  const asClient = page.getByRole("listitem").filter({ hasText: "Вы — покупатель" });
  await expect(asClient).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: "Вы — мастер" })).toHaveCount(2); // №5 и №8

  await asClient.getByRole("link", { name: /^Открыть/ }).click();
  await page.waitForURL(/\/switch-role\?/);
  const main = page.getByRole("main");
  await expect(main.getByText("Эта страница открывается в роли «Заказчик».")).toBeVisible();
  await main.getByRole("button", { name: "Перейти в роль «Заказчик»" }).click();

  await page.waitForURL(/\/deals\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Сделка №17" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Завершена", { exact: true }).first()).toBeVisible();

  // Роль сохраняется у пользователя: вернуть «Дала» мастером, как в сиде, — следующие тесты от этого не зависят.
  await page.goto("/switch-role?to=EXECUTOR");
  await page.getByRole("main").getByRole("button", { name: "Перейти в роль «Исполнитель»" }).click();
  await page.waitForURL((u) => u.pathname !== "/switch-role");
  await page.goto("/profile");
  await expect(page.getByRole("main").getByRole("definition").filter({ hasText: /^Исполнитель$/ })).toHaveCount(1);
});

test("профиль: «метка — значение» и разделы роли из меню, без заливной кнопки", async ({ page }) => {
  await loginAs(page, P.aigerim);
  await page.goto("/profile");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Профиль" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Назад", exact: true })).toBeVisible();
  // Кто вошёл — список «метка — значение».
  for (const term of ["Имя", "Роль", "Телефон"]) await expect(main.getByRole("term").filter({ hasText: term })).toHaveCount(1);
  await expect(main.getByRole("definition").filter({ hasText: /^Заказчик$/ })).toHaveCount(1);
  // Разделы — те же, что в меню роли (кроме вкладок): у заказчика в демо-режиме.
  const sections = main.getByRole("navigation", { name: "Разделы" }).getByRole("link");
  await expect(sections).toHaveText(["Мои заявки", "Работы", "Уведомления", "Показ банку", "Демо-персоны"]);
  await expect(main.locator("[data-primary-action]")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Выйти" })).toBeVisible();
  await expectNoHorizontalScrollAt320And200(page, "/profile");

  // Две роли (ADR-004): у мастера «Дала» — переключатель в роль заказчика и разделы мастера.
  await loginAs(page, P.dala);
  await page.goto("/profile");
  await expect(main.getByRole("button", { name: "Перейти в роль «Заказчик»" })).toBeVisible();
  await expect(main.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText([
    "Профиль компании",
    "Портфолио",
    "Уведомления",
    "Показ банку",
    "Демо-персоны",
  ]);
  await expect(main.locator("[data-primary-action]")).toHaveCount(0);
});

test("переключение роли: одна главная кнопка, «Назад», без прокрутки вбок", async ({ page }) => {
  await loginAs(page, P.dala);
  const path = "/switch-role?to=CLIENT&returnTo=%2Fdeals";
  await page.goto(path);
  await expect(page.getByRole("main").getByRole("link", { name: "Назад", exact: true })).toBeVisible();
  await expectOnePrimary(page);
  await expect(page.getByRole("main").locator("[data-primary-action]")).toHaveText("Перейти в роль «Заказчик»");
  await expectNoHorizontalScrollAt320And200(page, path);
});
