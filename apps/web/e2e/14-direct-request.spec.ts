import { expect, test } from "@playwright/test";
import { choose, expectNoHorizontalScrollAt320And200, loginAs, P, stepAction } from "./support";

/**
 * Прямой запрос по работе из каталога («Хочу похожее»): заявку получает только автор работы (Исп. №7, ИП Нурланова),
 * другие мастера её не видят. Сценарий только добавляет заявку — пересев не нужен.
 */

test("«Хочу похожее» из каталога: заявка уходит только автору работы", async ({ page }) => {
  await loginAs(page, P.madina);
  await page.goto("/catalog");
  await page.getByRole("link", { name: "Хочу похожее: «Обеденный стол из карагача», Исполнитель №7" }).click();
  await page.waitForURL(/\/requests\/new\?like=/);
  await expect(page.getByText("Заявку получит только Исполнитель №7 — автор понравившейся работы.")).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Какой уровень?" })).toBeVisible();
  await choose(page.getByRole("radio", { name: /^Премиум/ }));
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Фото и описание" })).toBeVisible();
  await page.getByLabel("Опишите своими словами").fill("Такой же стол, но на восемь человек");
  await page.getByRole("button", { name: "Далее" }).click();
  await page.getByLabel("Город").fill("Астана");
  await page.getByLabel("Адрес или район").fill("Астана, ул. Тестовая, 3, кв. 3");
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Проверьте и отправьте" })).toBeVisible();
  await expect(page.getByText(/Заявку увидит только Исполнитель №7/).first()).toBeVisible();
  await page.getByRole("button", { name: "Отправить заявку" }).click();
  await page.waitForURL(/\/requests\/[^/]+\?sent=1$/);
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const number = title.match(/^Заявка №(\d+):/)?.[1];
  expect(number, title).toBeTruthy();

  await loginAs(page, P.asel);
  await page.goto("/executor/requests");
  await expect(page.getByRole("link", { name: new RegExp(`^Заявка №${number}:`) }).first()).toBeVisible();

  await loginAs(page, P.erlan);
  await page.goto("/executor/requests");
  await expect(page.getByRole("link", { name: new RegExp(`^Заявка №${number}:`) })).toHaveCount(0);
});

test("карточка мастера: фото и цена работы, «метка — значение», плашка защиты, «Хочу похожее» в закреплённом слоте", async ({ page }) => {
  await loginAs(page, P.madina);
  await page.goto("/catalog");
  // Тип — чипами: фильтр в адресе.
  await page.getByRole("navigation", { name: "Что ищем" }).getByRole("link", { name: "Стол", exact: true }).click();
  await page.waitForURL(/\/catalog\?type=table$/);
  await expect(page.getByRole("link", { name: "Хочу похожее: «Обеденный стол из карагача», Исполнитель №7" })).toBeVisible();

  await page.goto("/executors/7");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "К каталогу" })).toBeVisible();
  await expect(main.getByRole("heading", { level: 1, name: "Исполнитель №7" })).toBeVisible();
  await expect(main.getByRole("term").filter({ hasText: "Сделок на платформе" })).toBeVisible();
  // Число сделок — один раз, строкой «метка — значение»; отдельного бейджа «N сделок» нет.
  await expect(main.getByText(/^\d+\s(сделка|сделки|сделок)$/)).toHaveCount(0);
  await expect(main.getByRole("note").filter({ hasText: "мастер получит деньги после вашей приёмки" })).toBeVisible();
  const action = stepAction(page);
  await expect(action).toHaveCount(1);
  await expect(action.locator("[data-primary-action]")).toHaveCount(1);
  await expect(main.locator("[data-primary-action]")).toHaveCount(1);
  await action.getByRole("link", { name: /^Хочу похожее/ }).click();
  await page.waitForURL(/\/requests\/new\?like=/);
  await expect(page.getByText("Заявку получит только Исполнитель №7 — автор понравившейся работы.")).toBeVisible();

  await expectNoHorizontalScrollAt320And200(page, "/executors/7");
});
