import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Спор и история денег покупателя (`/v2/deals/[id]/dispute`, `/money`) на засеянных людях — только чтение (спор не
 * отправляется; отправку и возврат проверяет сценарий `flows/dispute.spec.ts`): Айгерим (+7 700 000 01 01) — «Шкаф-купе»
 * оплачен, «Прихожая» без оплаты; Данияр (+7 700 000 01 02) — «Детская» со спором; Арман (+7 700 000 03 01) — завершённая
 * «Шкаф-купе» и возвращённая «Прихожая»; Ерболат (+7 700 000 03 05) — «Кабинет», спор решён разделом; Мадина (+7 700 000 01 03)
 * — посторонний человек.
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз, состояние входа — во временной папке ОС, общей с
 * другими сценариями покупателя (`senim-e2e-v2-states`), и переиспользуется, пока свежее.
 */

const t = ru.app.deal;
const money = t.money;
const dispute = t.dispute;

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

/** Общее для экранов: один h1, не больше одного главного действия, «Назад» с названием родителя, чистые слова. */
async function expectScreen(page: Page, parent: string): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${parent}` })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(FORBIDDEN);
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(420_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

test.beforeEach(() => {
  test.setTimeout(120_000);
});

test("история денег оплаченной сделки: блок денег, строка оплаты, «Защита сделки (2%)», выписка; нет «комиссии», «эскроу», «тестового»", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  const href = await dealHref(page, "Шкаф-купе");
  await open(page, `${href}/money`);
  await expectScreen(page, "Шкаф-купе");
  await expect(page.locator("h1")).toHaveText(money.title);
  await expect(page.locator("main")).toContainText(t.card.money.protected.title);
  await expect(page.locator("main")).toContainText("Защита сделки (2%)");
  await expect(page.getByRole("list", { name: money.operationsLabel }).getByText(money.type.HOLD)).toBeVisible();
  await expect(page.getByRole("link", { name: ru.app.deal.openDocument.MONEY_STATEMENT })).toBeVisible();
  await expect(page.getByRole("button", { name: money.shareNamed("Выписка по деньгам") }).first()).toBeVisible();
  await page.context().close();
});

test("история денег завершённой и возвращённой сделок: «Оплата переведена мастеру» без суммы, возврат вам", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "arman");
  await open(page, `${await dealHref(page, "Шкаф-купе", "done")}/money`);
  await expectScreen(page, "Шкаф-купе");
  const done = page.getByRole("list", { name: money.operationsLabel });
  await expect(done.getByText(money.payout)).toBeVisible();
  // Доля мастера и доход сервиса покупателю не показываются.
  await expect(page.locator("main")).not.toContainText(/гарантия оплаты|4%|доход/i);
  await open(page, `${await dealHref(page, "Прихожая", "done")}/money`);
  await expectScreen(page, "Прихожая");
  await expect(page.getByRole("list", { name: money.operationsLabel }).getByText(money.type.REFUND)).toBeVisible();
  await expect(page.locator("main")).toContainText(t.card.money.refunded.done);
  await page.context().close();
});

test("спор открыт: «Спор открыт», выплата приостановлена, причина и описание; главного действия нет, если позиция отправлена", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "daniyar");
  const href = await dealHref(page, "Детская");
  await open(page, `${href}/dispute`);
  await expectScreen(page, "Детская");
  await expect(page.locator("h1")).toHaveText(dispute.open.title);
  await expect(page.getByRole("heading", { level: 2, name: dispute.open.now.title })).toBeVisible();
  await expect(page.locator("main")).toContainText(dispute.open.now.body);
  await expect(page.locator("main")).toContainText(dispute.open.reason);
  await page.context().close();
});

test("спор решён разделом: решение и суммы из журнала, без главного действия", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erbolat");
  await open(page, `${await dealHref(page, "Кабинет", "done")}/dispute`);
  await expectScreen(page, "Кабинет");
  await expect(page.locator("h1")).toHaveText(dispute.resolved.title);
  await expect(page.getByRole("heading", { level: 2, name: dispute.resolved.outcome.PARTIAL_SPLIT.title })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  await page.context().close();
});

test("форма спора там, где спор возможен: причины, описание, фото, «Что будет дальше»; не отправляется", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  const href = await dealHref(page, "Шкаф-купе");
  await open(page, `${href}/dispute`);
  await expectScreen(page, "Шкаф-купе");
  await expect(page.locator("h1")).toHaveText(dispute.form.title);
  for (const reason of Object.values(dispute.reasons)) await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByLabel(dispute.form.descriptionLabel)).toBeVisible();
  await expect(page.getByRole("button", { name: dispute.form.addPhoto })).toBeVisible();
  await page.getByRole("button", { name: dispute.form.explain.label }).click();
  await expect(page.getByText(dispute.form.explain.points[0] ?? "")).toBeVisible();
  // Пустая форма: проверка у полей, подтверждения нет.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator("[data-primary-action]").click();
  await expect(page.getByText(dispute.form.errors.reason)).toBeVisible();
  await expect(page.getByText(dispute.form.errors.description)).toBeVisible();
  await expect(page.getByRole("dialog", { name: dispute.form.confirm.title })).toHaveCount(0);
  await page.context().close();
});

test("спор там, где открыть нельзя и спора нет, — карточка сделки", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  const href = await dealHref(page, "Прихожая");
  await open(page, `${href}/dispute`);
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await page.context().close();
});

test("чужая сделка: история денег и спор — 404 без раскрытия", async ({ browser }, info) => {
  const owner = await pageOf(browser, info, "aigerim");
  const href = await dealHref(owner, "Шкаф-купе");
  await owner.context().close();
  const page = await pageOf(browser, info, "madina");
  for (const screen of ["money", "dispute", "review"]) {
    const response = await page.goto(`${href}/${screen}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("main")).not.toContainText("Шкаф-купе");
  }
  await page.context().close();
});

test("документ по ссылке: неизвестный токен — 404 гостю", async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use });
  const page = await context.newPage();
  expect((await page.goto("/v2/d/net-takogo.zzzz.yyyy"))?.status()).toBe(404);
  expect((await page.goto("/v2/d/net-takogo.zzzz.yyyy/pdf"))?.status()).toBe(404);
  await context.close();
});
