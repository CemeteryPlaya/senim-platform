import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Компания, документы и счёт для оплаты мастера (`/v2/executor/profile`, `/kyc`, `/payout`) на засеянных
 * людях: Ерлан Жумабаев (+7 700 000 02 01) — одобренный мастер со сделками и предложениями; Алмас Тлеубаев
 * (+7 700 000 02 09) — анкета на проверке; Сценарий ничего не меняет
 * в данных (пересев не включается).
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз (с компьютера; телефон берёт то же состояние),
 * состояние входа лежит во временной папке ОС (вне репозитория) и переиспользуется, пока свежее.
 */

const m = ru.app.masterCompany;

const PEOPLE = { erlan: "+7 700 000 02 01", almas: "+7 700 000 02 09" } as const;
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

test.beforeAll(async ({ browser }, info) => {
  test.setTimeout(300_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

// Первый заход компилирует страницы dev-сервера: запас по времени.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

/** Один заголовок, не больше одного главного действия; полного IBAN в разметке нет. */
async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  expect(await page.content()).not.toMatch(/KZ\d{2}[A-Z0-9]{16}/);
}

test("компания одобренного мастера: «как вас видят», без раздела «Ещё по компании», форма, «Назад — Профиль»", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2/executor/profile");
  await expect(page.locator("h1")).toHaveText(m.company.title);
  await expect(page.getByText(m.company.now.APPROVED.title)).toBeVisible();
  await expect(page.getByText(/Исполнитель №\d+/).first()).toBeVisible();
  // Разделы одобренного мастера — на экране «Профиль», откуда он пришёл: здесь их нет.
  await expect(page.getByRole("navigation", { name: m.company.sections.title })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${m.shared.backProfile}`, exact: true })).toHaveAttribute("href", "/v2/profile");
  await expect(page.getByLabel(m.company.form.about.label)).toBeVisible();
  await expectScreenRules(page);
  await page.context().close();
});

test("документы: статус проверки и «Назад — Профиль» у одобренного", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2/executor/profile/kyc");
  await expect(page.locator("h1")).toHaveText(m.kyc.title);
  await expect(page.getByRole("link", { name: `${ru.app.kit.back}: ${m.shared.backProfile}`, exact: true })).toHaveAttribute("href", "/v2/profile");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: new RegExp(Object.values(m.kyc.status).join("|")) }).first()).toBeVisible();
  await expectScreenRules(page);
  await page.context().close();
});

test("счёт для оплаты: «KZ •••• …» или «Не указан», полного номера нет", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2/executor/profile/payout");
  await expect(page.locator("h1")).toHaveText(m.payout.title);
  await expect(page.getByText(/KZ •••• \d{4}|Не указан/).first()).toBeVisible();
  await expectScreenRules(page);
  await page.context().close();
});

test("мастер на проверке: компания открыта, публичной страницы и финансов нет, документы и счёт доступны", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "almas");
  await open(page, "/v2/executor/profile");
  await expect(page.getByText(m.company.now.PENDING.title)).toBeVisible();
  await expect(page.locator('a[href="/v2/executor/finance"]')).toHaveCount(0);
  await expect(page.locator('a[href="/v2/executor/profile/kyc"]').first()).toBeVisible();
  await expectScreenRules(page);
  await open(page, "/v2/executor/profile/payout");
  await expect(page.locator("h1")).toHaveText(m.payout.title);
  await expectScreenRules(page);
  await page.context().close();
});
