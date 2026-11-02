import { expect, test } from "@playwright/test";
import { loginAs, openDeal, P, reseed } from "./support";

/**
 * «Вдохновение» и портфолио из сделки (встреча 31.10, п. 2 и 3).
 * Демо: сделка №7 (Данияр ↔ ТОО «Ағаш Шебер») завершена, заказчик уже разрешил показ фото;
 * работа Ерлана из сделки уже во «Вдохновении» с пометкой «Выполнено на Сенім».
 */
const AGASH = "ТОО «Ағаш Шебер»";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(120_000);
  reseed();
});

test("гость: лента, фильтр чипом, карточка и «Хочу похожее» через вход", async ({ page }) => {
  await page.goto("/inspiration");
  await expect(page.getByRole("heading", { level: 1, name: "Вдохновение" })).toBeVisible();

  await page.getByRole("navigation", { name: "Что ищем" }).getByRole("link", { name: "Кухня", exact: true }).click();
  await page.waitForURL(/type=kitchen/);
  await expect(page.getByRole("navigation", { name: "Что ищем" }).getByRole("link", { name: "Кухня", exact: true })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: /Кухня 3,2 м под потолок/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Кухня 3,2 м под потолок" })).toBeVisible();
  await expect(page.getByText("Выполнено на Сенім")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Отзыв заказчика" })).toBeVisible();

  await page.getByRole("link", { name: "Хочу похожее" }).click();
  await page.waitForURL(/\/login\?next=/);
  expect(decodeURIComponent(page.url())).toContain("/requests/new?like=");
});

test("исполнитель добавляет итоговые фото сделки в портфолио — работа во «Вдохновении»", async ({ page }) => {
  await loginAs(page, AGASH);
  await openDeal(page, 7);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Фото в портфолио" }) });
  await expect(panel.getByText("Заказчик разрешил показ.")).toBeVisible();
  await panel.getByRole("link", { name: "Добавить в портфолио" }).click();

  await page.waitForURL(/\/executor\/portfolio\/from-deal\//);
  await expect(page.getByRole("checkbox", { name: "Итоговое фото 1" })).toBeChecked();
  await page.getByLabel("Где делали").fill("Астана, ул. Тестовая 5");
  await page.getByRole("button", { name: "Добавить в портфолио" }).click();
  await expect(page.getByText("без улицы, дома и квартиры").first()).toBeVisible();

  await page.getByLabel("Где делали").fill("Астана, район Нура");
  await page.getByRole("button", { name: "Добавить в портфолио" }).click();
  await page.waitForURL(/\/executor\/portfolio\/(?!from-deal)[^/]+$/);
  await expect(page.getByText("Выполнено на Сенім").first()).toBeVisible();

  await page.goto("/inspiration?type=kitchen&style=neoclassic");
  await expect(page.getByRole("link", { name: /Кухня с островом, шпон дуба/ })).toBeVisible();
});

test("заказчик отзывает разрешение — работа скрыта из ленты", async ({ page }) => {
  await loginAs(page, P.daniyar);
  await openDeal(page, 7);
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Фото в портфолио" }) });
  await panel.getByRole("checkbox", { name: /Разрешаю показать фото моей мебели/ }).uncheck();
  await panel.getByRole("button", { name: "Отозвать разрешение" }).click();
  await expect(panel.getByText("Пока не разрешено")).toBeVisible();

  await page.goto("/inspiration?type=kitchen&style=neoclassic");
  await expect(page.getByRole("link", { name: /Кухня с островом, шпон дуба/ })).toHaveCount(0);
});
