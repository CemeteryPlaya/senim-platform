import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Карточка заявки покупателя (`/v2/requests/[id]`) на засеянных людях: Айгерим (+7 700 000 01 01) — заявка с тремя
 * предложениями; Данияр (+7 700 000 01 02) — прямая заявка без предложений, чужая для Мадины (+7 700 000 01 03).
 * Сценарий ничего не меняет в данных (отмена — интеграционным тестом, пересев не включается). Порядок мастеров зависит
 * от сида: у заявки с тремя предложениями дешевле всех мастер №4, быстрее всех — №2.
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз (с компьютера; телефон берёт то же состояние), состояние входа
 * лежит во временной папке ОС (вне репозитория) и переиспользуется, пока свежее; тесты берут из него новое окно.
 */

const t = ru.app.requestCard;
const list = ru.app.requests.list;

const PEOPLE = { aigerim: "+7 700 000 01 01", daniyar: "+7 700 000 01 02", madina: "+7 700 000 01 03" } as const;
type Person = keyof typeof PEOPLE;

const STATE_DIR = path.join(os.tmpdir(), "senim-e2e-v2-states");
const FRESH_MS = 45 * 60_000;

/** Один файл на человека: сессия не привязана к устройству, поэтому телефон берёт вход, сделанный с компьютера. */
const stateFile = (person: Person) => path.join(STATE_DIR, `${person}.json`);

/** Вход человека один раз на проект: готовое свежее состояние берётся из файла, иначе входим и сохраняем. */
async function ensureState(browser: Browser, info: TestInfo, person: Person): Promise<string> {
  const file = stateFile(person);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < FRESH_MS) return file;
  mkdirSync(STATE_DIR, { recursive: true });
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: info.project.use.baseURL });
  try {
    await loginV2(await context.newPage(), PEOPLE[person]);
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
  return file;
}

/** Новое окно браузера, уже вошедшее этим человеком. */
async function pageOf(browser: Browser, info: TestInfo, person: Person): Promise<Page> {
  const context = await browser.newContext({ ...info.project.use, storageState: stateFile(person) });
  return context.newPage();
}

async function openRequestWithOffers(page: Page, count: number): Promise<void> {
  await open(page, "/v2/requests");
  await page.locator("main a[href^='/v2/requests/']").filter({ hasText: list.offers(count) }).first().click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
}

const masters = (page: Page) => page.locator("main a[href*='/offers/']").evaluateAll((links) => links.map((a) => a.textContent?.match(/Исполнитель №(\d+)/)?.[1] ?? ""));

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

// Первый заход компилирует страницы dev-сервера: запас по времени.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

test("заявка с тремя предложениями: «Исполнитель №N» без имён, сортировка в адресе меняет порядок", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await openRequestWithOffers(page, 3);

  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { level: 2, name: ru.app.buyer.home.now.offers.title(3) })).toBeVisible();
  await expect(page.getByRole("link", { name: /Исполнитель №\d+/ })).toHaveCount(3);
  // Имени и контактов мастера на экране нет, только номер.
  await expect(page.locator("main")).not.toContainText(/ТОО|\+7\s?\d{3}|@/);

  // По умолчанию — дешевле: №4, №3, №2.
  await expect(page.getByRole("button", { name: t.offers.sort.price })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["4", "3", "2"]);

  // «Быстрее»: адрес меняется, порядок меняется.
  await page.getByRole("button", { name: t.offers.sort.duration }).click();
  await page.waitForURL(/[?&]sort=duration/);
  await expect(page.getByRole("button", { name: t.offers.sort.duration })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["2", "3", "4"]);

  // Сортировка переживает перезагрузку: она в адресе.
  await page.reload();
  await expect(page.getByRole("button", { name: t.offers.sort.duration })).toHaveAttribute("aria-pressed", "true");
  expect(await masters(page)).toEqual(["2", "3", "4"]);

  // Предложение открывается ссылкой на свой экран v2.
  await page.getByRole("link", { name: /Исполнитель №2/ }).click();
  await page.waitForURL(/\/v2\/requests\/[^/]+\/offers\/[^/]+/);
  await page.context().close();
});

test("меню «Действия»: подтверждение отмены открывается и закрывается «Не отменять», заявка остаётся", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await openRequestWithOffers(page, 3);
  const url = page.url();

  await page.getByRole("button", { name: t.actions.menu }).click();
  await page.getByText(t.actions.cancel, { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: t.actions.cancelTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(t.actions.cancelBody(3));
  // Первый фокус — на «Не отменять»; Enter закрывает окно, ничего не отменяя.
  await expect(dialog.getByRole("button", { name: t.actions.cancelKeep })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("heading", { level: 2, name: ru.app.buyer.home.now.offers.title(3) })).toBeVisible();
  await page.context().close();
});

test("прямая заявка без предложений: обучающий экран без кнопки, «Заявка для: Исполнитель №N»", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "daniyar");
  await open(page, "/v2/requests");
  await page.locator("main a[href^='/v2/requests/']").filter({ hasText: list.direct }).first().click();
  await page.waitForURL(/\/v2\/requests\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 2, name: t.now.waitingDirect.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: t.offers.emptyDirect.title })).toBeVisible();
  expect(await page.locator("[data-primary-action]").count()).toBe(0);
  await expect(page.locator("main")).toContainText(/Заявка для\s*Исполнитель №\d+/);
  await page.context().close();
});

test("чужая и несуществующая заявка — 404", async ({ browser }, info) => {
  const owner = await pageOf(browser, info, "daniyar");
  await open(owner, "/v2/requests");
  const foreign = await owner.locator("main a[href^='/v2/requests/']").first().getAttribute("href");
  expect(foreign).toBeTruthy();
  await owner.context().close();

  const page = await pageOf(browser, info, "madina");
  for (const href of [foreign ?? "", "/v2/requests/net-takoj-zayavki"]) {
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(404);
  }
  await page.context().close();
});
