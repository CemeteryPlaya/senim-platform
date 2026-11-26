import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Сделки покупателя (`/v2/deals`, `/v2/deals/[id]`) на засеянных людях — только чтение (отмена — интеграционным тестом,
 * пересев не включается): Айгерим (+7 700 000 01 01) — оферта не подписана, «Шкаф-купе» оплачен, «Кухня» в работе;
 * Данияр (+7 700 000 01 02) — «Детская» со спором; Мадина (+7 700 000 01 03) — «Стеллаж»: оферта подписана, а согласия
 * мастера для банка в сиде нет (оплата закрыта); Арман (+7 700 000 03 01) — завершённая и возвращённая; Ерболат
 * (+7 700 000 03 05) — «Кабинет», спор решён разделом.
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз (с компьютера; телефон берёт то же состояние);
 * состояние лежит во временной папке ОС (вне репозитория), общей с другими сценариями покупателя, и переиспользуется,
 * пока свежее.
 */

const t = ru.app.deal;
const card = t.card;

const PEOPLE = {
  aigerim: "+7 700 000 01 01",
  daniyar: "+7 700 000 01 02",
  madina: "+7 700 000 01 03",
  arman: "+7 700 000 03 01",
  erbolat: "+7 700 000 03 05",
} as const;
type Person = keyof typeof PEOPLE;

const STATE_DIR = path.join(os.tmpdir(), "senim-e2e-v2-states");
const FRESH_MS = 45 * 60_000;
const stateFile = (person: Person) => path.join(STATE_DIR, `${person}.json`);

async function ensureState(browser: Browser, info: TestInfo, person: Person): Promise<void> {
  const file = stateFile(person);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < FRESH_MS) return;
  mkdirSync(STATE_DIR, { recursive: true });
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: info.project.use.baseURL });
  try {
    await loginV2(await context.newPage(), PEOPLE[person]);
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
}

async function pageOf(browser: Browser, info: TestInfo, person: Person): Promise<Page> {
  const context = await browser.newContext({ ...info.project.use, storageState: stateFile(person) });
  return context.newPage();
}

/** Слова, которых покупатель не видит. */
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|отклик/i;

/** Адрес сделки из списка по названию заказа. */
async function dealHref(page: Page, title: string, group: "active" | "done" = "active"): Promise<string> {
  await open(page, `/v2/deals?group=${group}`);
  const href = await page.locator("main a[href^='/v2/deals/']").filter({ hasText: title }).first().getAttribute("href");
  if (!href) throw new Error(`Сделка «${title}» не найдена в списке`);
  return href;
}

/** Общее для каждой карточки сделки: один h1, не больше одного главного действия, блок денег с защитой, чистые слова. */
async function expectCard(page: Page): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${card.back}` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: card.money.section, exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(FORBIDDEN);
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

test.beforeEach(() => {
  test.setTimeout(120_000);
});

test("список: группы «Идут» и «Завершены», карточки-ссылки, плашка называет шаг, без запретных слов", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await open(page, "/v2/deals");
  await expect(page.locator("h1")).toHaveText(t.list.title);
  await expect(page.getByRole("link", { name: t.list.groups.active(3) })).toBeVisible();
  await expect(page.locator("main a[href^='/v2/deals/']")).toHaveCount(3);
  await expect(page.locator("main")).toContainText(t.status.signOffer);
  await expect(page.locator("main")).toContainText(t.line.inBank);
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(FORBIDDEN);
  // «Помощи» в списке нет: те же вопросы — внутри каждой сделки. Обычный ход («Деньги под защитой») без плашки.
  await expect(page.locator("main a[href='/v2/help#money']")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(t.status.protected);

  const arman = await pageOf(browser, info, "arman");
  await open(arman, "/v2/deals");
  // Идущих нет — сразу «Завершены»: завершённая и возвращённая; возврат — «вернулись вам», а не «покупателю».
  await expect(arman.getByRole("link", { name: t.list.groups.done(2) })).toHaveAttribute("aria-current", "true");
  await expect(arman.locator("main a[href^='/v2/deals/']")).toHaveCount(2);
  await expect(arman.locator("main")).toContainText(t.line.refundDone);
  await expect(arman.locator("main")).not.toContainText(/покупател/);
  await page.context().close();
  await arman.context().close();
});

test("оферта не подписана: «Подписать оферту» — единственное главное действие; контакты мастера скрыты", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await open(page, await dealHref(page, "Прихожая"));
  await expectCard(page);
  await expect(page.getByRole("heading", { level: 2, name: card.now.signOffer.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveText(card.now.signOffer.action);
  await expect(page.locator("main")).toContainText(card.master.hidden);
  await expect(page.locator("main a[href^='tel:']")).toHaveCount(0);
  await page.context().close();
});

test("оплата закрыта до согласия мастера для банка: «Ждём согласие мастера» без кнопки, в списке — то же; без доплат к цене", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "madina");
  // В сиде на шаге оплаты одна сделка — «Стеллаж», и согласия мастера у неё нет; кнопку «Оплатить N ₸» при согласиях
  // обеих сторон проверяет интеграционный тест.
  await open(page, "/v2/deals");
  await expect(page.locator("main")).toContainText(t.status.waitMasterBank);
  await expect(page.locator("main")).not.toContainText(t.status.pay);
  await open(page, await dealHref(page, "Стеллаж"));
  await expectCard(page);
  await expect(page.getByRole("heading", { level: 2, name: card.now.payWaitMaster.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Защита сделки");
  await page.getByRole("button", { name: card.money.explain.label }).first().click();
  await expect(page.getByText(card.money.explain.body)).toBeVisible();
  await page.context().close();
});

test("деньги под защитой и работа идёт: главного действия нет, контакты мастера открыты", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  for (const title of ["Шкаф-купе", "Кухня"]) {
    await open(page, await dealHref(page, title));
    await expectCard(page);
    await expect(page.locator("[data-primary-action]")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(card.money.protected.title);
    // Дата резерва — в истории денег (на карточке она повторяла бы «Историю»).
    await expect(page.locator("main")).not.toContainText(/Зарезервировано \d/);
    await expect(page.locator("main a[href^='tel:']")).toHaveCount(1);
    // История — словами покупателя, без служебных событий и без отчётов мастера (они — в «Ходе работ»).
    await expect(page.locator("main")).toContainText(title === "Кухня" ? card.history.started : card.history.paid);
    await expect(page.locator("main")).not.toContainText(/Сформирован документ|Банк провёл операцию|Событие по сделке/);
  }
  await page.context().close();
});

test("спор решён разделом: «Спор решён: деньги разделены», раздела «Ход сделки» нет, «Вы оплатили»", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erbolat");
  await open(page, await dealHref(page, "Кабинет", "done"));
  await expectCard(page);
  await expect(page.getByRole("heading", { level: 2, name: card.now.disputeSplit.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: card.steps.section, exact: true })).toHaveCount(0);
  await expect(page.locator("main")).toContainText(card.money.completed.title);
  await expect(page.locator("main")).not.toContainText(ru.app.deal.allStepsDone);
  await page.context().close();
});

test("спор: «Спор рассматривает оператор», выплата приостановлена, без главного действия", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "daniyar");
  await open(page, await dealHref(page, "Детская"));
  await expectCard(page);
  await expect(page.getByRole("heading", { level: 2, name: card.now.dispute.title })).toBeVisible();
  await expect(page.locator("main")).toContainText(card.money.frozen.title);
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await page.context().close();
});

test("завершена и возвращена: объяснение, что с деньгами; главное действие — только отзыв", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "arman");
  await open(page, await dealHref(page, "Прихожая", "done"));
  await expectCard(page);
  // Возврат по сделке с офертой — окончание сделки: «Сейчас» предлагает отзыв (спека 2026-11-17, 3.4; флаг reviews включён),
  // что с деньгами — в блоке денег.
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^(${card.now.refunded.title}|${card.now.review.title})$`) })).toBeVisible();
  await expect(page.locator("main")).toContainText(card.money.refunded.done);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-primary-action]:not([href$="/review"])')).toHaveCount(0);
  await open(page, await dealHref(page, "Шкаф-купе", "done"));
  await expectCard(page);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.locator("main")).toContainText(card.money.completed.done);
  await page.context().close();
});

test("чужая сделка — 404 без раскрытия", async ({ browser }, info) => {
  const owner = await pageOf(browser, info, "aigerim");
  const href = await dealHref(owner, "Кухня");
  await owner.context().close();
  const page = await pageOf(browser, info, "madina");
  const response = await page.goto(href);
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(ru.app.shell.notFoundTitle);
  await expect(page.locator("main")).not.toContainText("Кухня");
  await page.context().close();
});

test("меню «Действия»: отмена с точными последствиями; «Не отменять» и Esc возвращают фокус на «Действия»", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await open(page, await dealHref(page, "Шкаф-купе"));
  const url = page.url();
  const menuButton = page.getByRole("button", { name: card.actions.menu });

  await menuButton.click();
  await page.getByText(card.actions.cancel, { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: card.actions.cancelTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Сделка будет отменена, .+ вернутся на вашу карту — включая защиту сделки\./);
  await expect(dialog.getByRole("button", { name: card.actions.keep })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
  expect(page.url()).toBe(url);

  await menuButton.click();
  await page.getByText(card.actions.cancel, { exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
  await expect(page.locator("main")).toContainText(card.money.protected.title);
  await page.context().close();
});
