import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * «Сделки», карточка сделки и чаты глазами засеянного мастера Ерлана Жумабаева (+7 700 000 02 01): кухня в работе
 * (IN_PROGRESS), прихожая и шкаф с возвратом по спору. Сценарий только читает: ничего не подписывает и не отправляет.
 *
 * Вход — один раз на файл (тот же файл состояния, что у `master-requests.spec.ts`, во временной папке ОС): identity даёт на
 * номер 5 кодов в час.
 */

const d = ru.app.deal;
const md = ru.app.masterDeal;
const m = ru.app.master.deal;

const PHONE = "+7 700 000 02 01";
const STATE_DIR = path.join(os.tmpdir(), "senim-e2e-v2-states");
const STATE = path.join(STATE_DIR, "erlan.json");
const FRESH_MS = 45 * 60_000;

/** Слова, которых мастер не видит: стороны покупателя (защита 2%, «к оплате»), старые («заказчик», «отклик», «выплата»), запретные. */
const NOT_FOR_MASTER = /Защита сделки|2\s?%|к оплате|заказчик|отклик|выплат|комисси|эскроу|(^|[^а-яё])демо([^а-яё]|$)|тестов|платформ/i;

async function ensureState(browser: Browser, info: TestInfo): Promise<void> {
  if (existsSync(STATE) && Date.now() - statSync(STATE).mtimeMs < FRESH_MS) return;
  mkdirSync(STATE_DIR, { recursive: true });
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: info.project.use.baseURL });
  try {
    await loginV2(await context.newPage(), PHONE);
    await context.storageState({ path: STATE });
  } finally {
    await context.close();
  }
}

async function pageOf(browser: Browser, info: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...info.project.use, storageState: STATE });
  return context.newPage();
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(240_000);
  await ensureState(browser, info);
});

// Первый заход компилирует страницы dev-сервера: запас по времени.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

async function expectScreenRules(page: Page, primaries: { max: number }) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(primaries.max);
  await expect(page.locator("main")).not.toContainText(NOT_FOR_MASTER);
}

/** Карточки сделок в списке. */
const dealLinks = (page: Page) => page.locator('main a[href^="/v2/deals/"]');

test("«Сделки» мастера: только его сделки, плашки и деньги словами мастера — «вы получите», без сумм и слов покупателя", async ({ browser }, info) => {
  const page = await pageOf(browser, info);
  await open(page, "/v2/deals");
  await expect(page.locator("h1")).toHaveText(d.list.title);
  await expect(dealLinks(page).first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/вы получите|вы получили|банк переводит вам|Оплата вам приостановлена/);
  await expectScreenRules(page, { max: 0 });
  // Группа «Завершены» — по чипу, адрес меняется.
  const done = page.getByRole("link", { name: new RegExp(`^Завершены · \\d+`) });
  await done.click();
  await page.waitForURL(/\?group=done$/);
  await expectScreenRules(page, { max: 0 });
  await page.context().close();
});

test("карточка сделки в работе: одно главное действие шага мастера, блок денег мастера, «Покупатель», «Назад: Сделки»", async ({ browser }, info) => {
  const page = await pageOf(browser, info);
  await open(page, "/v2/deals");
  const kitchen = dealLinks(page).filter({ hasText: /Кухня/ }).first();
  test.skip((await kitchen.count()) === 0, "нужен пересев: кухня Ерлана в работе не найдена");
  await kitchen.click();
  await page.waitForURL(/\/v2\/deals\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
  await expectScreenRules(page, { max: 1 });
  await expect(page.getByRole("link", { name: new RegExp(d.card.back) }).first()).toHaveAttribute("href", "/v2/deals");
  const primary = page.locator("[data-primary-action]");
  if ((await primary.count()) === 1) await expect(primary).toHaveAttribute("href", /\/v2\/deals\/[^/]+\/(ready|start|sign\/[^/]+)$/);
  await expect(page.getByText(md.card.money.guarantee).first()).toBeVisible();
  await expect(page.getByText(md.card.money.youGet, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: md.card.buyer.section, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: md.card.buyer.write })).toHaveAttribute("href", /^\/v2\/chats\//);
  await expect(page.getByRole("heading", { level: 2, name: d.card.steps.section, exact: true })).toBeVisible();
  await page.context().close();
});

test("завершённые сделки мастера открываются без главного действия; деньги — без сумм покупателя", async ({ browser }, info) => {
  const page = await pageOf(browser, info);
  await open(page, "/v2/deals?group=done");
  const first = dealLinks(page).first();
  test.skip((await first.count()) === 0, "нужен пересев: у Ерлана нет завершённых сделок");
  await first.click();
  await page.waitForURL(/\/v2\/deals\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
  await expectScreenRules(page, { max: 0 });
  await expect(page.getByRole("heading", { level: 2, name: d.card.money.section, exact: true })).toBeVisible();
  await page.context().close();
});

test("чаты мастера: список → диалог с «Покупатель», ссылка «к чему относится», поле «Сообщение покупателю»; без главного действия", async ({ browser }, info) => {
  const page = await pageOf(browser, info);
  await open(page, "/v2/chats");
  await expect(page.locator("h1")).toHaveText(ru.app.chat.list.title);
  const link = page.locator('main a[href^="/v2/chats/"]').first();
  test.skip((await link.count()) === 0, "нужен пересев: у Ерлана нет переписки");
  await expect(page.getByRole("navigation", { name: md.chat.list.label })).toBeVisible();
  await link.click();
  await page.waitForURL(/\/v2\/chats\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1")).toHaveText(md.chat.counterpart);
  await expectScreenRules(page, { max: 0 });
  await expect(page.locator("main a[href^='/v2/deals/'], main a[href^='/v2/executor/requests/']").first()).toBeVisible();
  await expect(page.getByRole("log", { name: md.chat.room.log })).toBeVisible();
  const composer = page.getByLabel(md.chat.room.composerLabel);
  if ((await composer.count()) > 0) await expect(composer).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(ru.app.chat.room.back) }).first()).toHaveAttribute("href", "/v2/chats");
  await page.context().close();
});

test("плашка карточки — словами мастера (один из текстов `ru.app.master.deal.status`)", async ({ browser }, info) => {
  const page = await pageOf(browser, info);
  await open(page, "/v2/deals");
  const href = await dealLinks(page).first().getAttribute("href");
  test.skip(href === null, "нужен пересев: у Ерлана нет сделок");
  await open(page, href ?? "/v2/deals");
  const texts = Object.values(m.status);
  const header = await page.locator("main").first().innerText();
  expect(texts.some((text) => header.includes(text))).toBe(true);
  await page.context().close();
});
