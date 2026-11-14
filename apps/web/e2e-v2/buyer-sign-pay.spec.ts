import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Экраны подписи (`/v2/deals/<id>/sign/<docId>`) и оплаты (`/v2/deals/<id>/pay`) на засеянных людях — только чтение:
 * ничего не подписывается и не оплачивается (это — сценарий flows/deal.spec.ts с пересевом). Айгерим (+7 700 000 01 01) —
 * «Прихожая»: оферта не подписана; Данияр (+7 700 000 01 02) — «Гардеробная»: работа сдана у адреса, акт ждёт подписи
 * покупателя; Мадина (+7 700 000 01 03) — «Стеллаж»: оферта заключена, ждёт оплаты. Предупреждение о расстоянии (GPS) —
 * в интеграционном тесте экрана: в сиде акт сданной вдали «ТВ-зоны» покупатель уже подписал.
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз (с компьютера; телефон берёт то же состояние);
 * состояние — во временной папке ОС, общей с другими сценариями покупателя (buyer-deal.spec.ts), пока свежее.
 */

const t = ru.app.deal;
const sign = t.sign;
const pay = t.pay;

const PEOPLE = { aigerim: "+7 700 000 01 01", daniyar: "+7 700 000 01 02", madina: "+7 700 000 01 03" } as const;
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

const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|отклик/i;
const RESEED = "сид изменён прогоном flows — нужен пересев (E2E_FLOWS=1)";

/** Адрес сделки из списка «Идут» по названию заказа. */
async function dealHref(page: Page, title: string): Promise<string> {
  await open(page, "/v2/deals?group=active");
  const href = await page.locator("main a[href^='/v2/deals/']").filter({ hasText: title }).first().getAttribute("href");
  if (!href) throw new Error(`Сделка «${title}» не найдена в списке: ${RESEED}`);
  return href;
}

/** Адрес главного действия карточки сделки (подпись документа) — так покупатель и попадает на экран подписи. */
async function signHref(page: Page, title: string, action: string): Promise<string> {
  await open(page, await dealHref(page, title));
  const primary = page.locator("[data-primary-action]");
  await expect(primary, RESEED).toHaveText(action);
  const href = await primary.getAttribute("href");
  if (!href?.includes("/sign/")) throw new Error(`Главное действие «${action}» ведёт не на подпись: ${href}`);
  return href;
}

async function expectScreen(page: Page, title: string, back: string): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText(title);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${back}` })).toBeVisible();
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.locator("main")).not.toContainText(FORBIDDEN);
}

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(300_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

test.beforeEach(() => {
  test.setTimeout(120_000);
});

test("оферта: что подписываю, PDF в новой вкладке, шаг «от руки» — «Подписать» отключена, пока нет подписи", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "aigerim");
  await open(page, await signHref(page, "Прихожая", t.card.now.signOffer.action));
  await expectScreen(page, sign.title.CONTRACT, "Прихожая");
  const what = page.getByRole("heading", { level: 2, name: sign.what.section });
  await expect(what).toBeVisible();
  await expect(page.locator("main")).toContainText(sign.what.total);
  const pdf = page.getByRole("link", { name: new RegExp(`^${sign.what.open}`) });
  await expect(pdf).toHaveAttribute("target", "_blank");
  await expect(pdf).toHaveAttribute("href", /^\/api\/documents\/[^/]+\/pdf$/);
  const res = await page.request.get((await pdf.getAttribute("href")) ?? "");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  // Шаг 1 из 2 — подпись от руки. Пока подписи нет, главная кнопка отключена, причина видна рядом.
  await expect(page.getByRole("heading", { level: 2, name: sign.hand.section })).toBeVisible();
  await expect(page.locator("main")).toContainText(sign.stepOf(1, 2));
  const submit = page.locator("[data-primary-action]");
  await expect(submit).toHaveText(sign.hand.submit);
  await expect(submit).toBeDisabled();
  await expect(page.getByText(sign.hand.empty)).toBeVisible();
  // Ввод ФИО — доступная замена холсту: кнопка становится доступна. Не нажимаем: данные стенда не меняются.
  await page.getByRole("button", { name: ru.app.kit.signature.typeName }).click();
  await page.getByLabel(ru.app.kit.signature.nameLabel).fill("Сапарова Айгерим");
  await expect(submit).toBeEnabled();
  await expect(page.getByText(sign.hand.empty)).toHaveCount(0);
  await page.context().close();
});

test("акт приёмки: «Примите мебель», что значит подпись; сдано у адреса — без предупреждения о расстоянии", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "daniyar");
  await open(page, await signHref(page, "Гардеробная", t.card.now.accept.action));
  await expectScreen(page, sign.title.ACCEPTANCE_ACT, "Гардеробная");
  await expect(page.getByText(sign.act.farTitle)).toHaveCount(0);
  await expect(page.locator("main")).toContainText(sign.act.meaning);
  await expect(page.locator("main")).toContainText(sign.act.notLiked);
  await expect(page.locator("main")).not.toContainText(sign.what.total);
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);
  await page.context().close();
});

test("оплата: смета, «Защита сделки (2%)» с пояснением, «Где будут деньги», согласие для банка; одно главное или чего ждём", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "madina");
  const deal = await dealHref(page, "Стеллаж");
  await open(page, `${deal}/pay`);
  await expect(page, RESEED).toHaveURL(new RegExp(`${deal}/pay$`));
  await expectScreen(page, pay.title, "Стеллаж");
  await expect(page.locator("main")).toContainText(pay.money.protection);
  await expect(page.locator("main")).toContainText(pay.money.total);
  await expect(page.getByRole("heading", { level: 2, name: pay.where.section })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: pay.consent.section })).toBeVisible();
  // Оплата открыта, только когда обе стороны дали согласие банку (identity стенда); иначе экран говорит, чего ждём.
  const waiting = page.getByRole("heading", { level: 2, name: pay.waitMaster.title });
  if (await waiting.isVisible()) await expect(page.locator("[data-primary-action]")).toHaveCount(0);
  else await expect(page.locator("[data-primary-action]")).toHaveText(/^Оплатить \d/);
  // Своё согласие не дано — текст в области с прокруткой и отметка; дано — «Согласие дано».
  const region = page.getByRole("region", { name: pay.consent.textLabel });
  if (await region.isVisible()) await expect(page.getByRole("checkbox", { name: pay.consent.agree })).toBeVisible();
  else await expect(page.getByText(pay.consent.given, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: pay.money.explain.label }).first().click();
  await expect(page.getByText(pay.money.explain.body)).toBeVisible();
  await page.context().close();
});

test("чужая сделка и чужой документ — 404 без раскрытия", async ({ browser }, info) => {
  const owner = await pageOf(browser, info, "aigerim");
  const href = await signHref(owner, "Прихожая", t.card.now.signOffer.action);
  const deal = href.slice(0, href.indexOf("/sign/"));
  await owner.context().close();
  const page = await pageOf(browser, info, "madina");
  for (const path of [href, `${deal}/pay`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText(ru.app.shell.notFoundTitle);
    await expect(page.locator("main")).not.toContainText("Прихожая");
  }
  await page.context().close();
});
