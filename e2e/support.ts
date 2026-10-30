import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Общие шаги e2e: демо-персоны, пересев базы, подпись документа.
 * Селекторы — по ролям и подписям из `ru`: так тест заодно проверяет доступность.
 */

/** Демо-персоны: имя — как на кнопке «Войти: …» страницы /demo (у исполнителя — наименование). */
export const P = {
  dinara: "Динара Абенова",
  aigerim: "Айгерим Сапарова",
  daniyar: "Данияр Ахметов",
  madina: "Мадина Касымова",
  erlan: "Жумабаев Ерлан Серикович", // Исполнитель №3, Комфорт
  kim: "ИП Ким Руслан Владимирович", // Исполнитель №5, Комфорт
  almas: "Тлеубаев Алмас Бауыржанович", // Исполнитель №10, PENDING
} as const;

/** Телефоны демо-персон в том виде, как их вводит человек. */
export const PHONE = {
  daniyar: "+7 700 000 01 02",
  madina: "+7 700 000 01 03",
  timur: "+7 700 000 02 04",
  samat: "+7 700 000 02 08",
} as const;

/**
 * Свежие демо-данные. Сид при DEMO_MODE=true сам очищает таблицы (resetDemo, RESTART IDENTITY),
 * поэтому номера заявок и сделок — как в docs/agents/DEMO_DATA.md. Только база «*e2e*».
 */
export function reseed(): void {
  const url = process.env.E2E_DATABASE_URL ?? "";
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("E2E_DATABASE_URL должна указывать на базу с «e2e» в имени");
  const bin = path.resolve("node_modules/.bin");
  const env = { ...process.env, DATABASE_URL: url, DEMO_MODE: "true", PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "seed"], { env, stdio: "pipe" });
}

/** Вход демо-персоной одним нажатием (выход из прежней сессии — очисткой cookie). */
export async function loginAs(page: Page, name: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/demo");
  await page.getByRole("button", { name: `Войти: ${name}` }).click();
  await page.waitForURL((u) => u.pathname !== "/demo");
}

/**
 * Выбор карточки RadioCards: сам radio визуально скрыт (sr-only), человек нажимает на карточку-label.
 * Находим radio по роли и имени (проверка доступности), нажимаем на его карточку.
 */
export async function choose(radio: Locator): Promise<void> {
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

/** Открыть сделку по номеру из списка «Сделки» текущего пользователя. */
export async function openDeal(page: Page, n: number): Promise<string> {
  await page.goto("/deals");
  await page.getByRole("link", { name: `Открыть: Сделка №${n}`, exact: true }).click();
  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: `Сделка №${n}` })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Открыть заявку заказчика по номеру из «Мои заявки». */
export async function openMyRequest(page: Page, n: number): Promise<string> {
  await page.goto("/requests");
  await page.getByRole("link", { name: new RegExp(`^Открыть ?: Заявка №${n}:`) }).click();
  await page.waitForURL(/\/requests\/[^/?]+/);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Заявка №${n}:`) })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Блок «Что дальше» на экране сделки. */
export function nextStep(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Что дальше", exact: true }) });
}

/**
 * Подпись документа из «Что дальше»: «Перейти к подписи» ведёт к панели документа,
 * дальше — мок eGov QR → «Я подписал — проверить». Возвращает панель документа.
 */
export async function signFromNextStep(page: Page, opts: { doubleClick?: boolean } = {}): Promise<Locator> {
  const go = nextStep(page).getByRole("link", { name: "Перейти к подписи" });
  const anchor = await go.getAttribute("href");
  if (!anchor?.startsWith("#doc-")) throw new Error(`Неожиданная ссылка на документ: ${anchor}`);
  await go.click();
  const panel = page.locator(anchor);
  await expect(panel.getByRole("radio", { name: /eGov Mobile/ })).toBeChecked();
  await panel.getByRole("button", { name: "Подписать", exact: true }).click();
  await expect(panel.getByRole("img", { name: "QR-код для подписи в eGov Mobile" })).toBeVisible();
  const confirm = panel.getByRole("button", { name: "Я подписал — проверить" });
  if (opts.doubleClick) await confirm.dblclick();
  else await confirm.click();
  return panel;
}
