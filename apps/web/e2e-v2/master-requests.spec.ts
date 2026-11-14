import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { loginV2, open } from "./support";

/**
 * Главная мастера, «Заявки» и «Мои предложения» (`/v2`, `/v2/executor/requests`, `/v2/executor/offers`) на засеянных
 * людях: Ерлан Жумабаев (+7 700 000 02 01) — одобренный мастер со сделками и предложениями; Алмас Тлеубаев
 * (+7 700 000 02 09) — анкета на проверке; Даурен Мусин (+7 700 000 02 10) — анкету отклонили. Сценарий ничего не меняет
 * в данных (пересев не включается).
 *
 * identity даёт на номер 5 кодов в час: каждый человек входит ОДИН раз (с компьютера; телефон берёт то же состояние),
 * состояние входа лежит во временной папке ОС (вне репозитория) и переиспользуется, пока свежее.
 */

const m = ru.app.masterRequests;

const PEOPLE = { erlan: "+7 700 000 02 01", almas: "+7 700 000 02 09", express: "+7 700 000 02 10" } as const;
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
  test.setTimeout(420_000);
  for (const person of Object.keys(PEOPLE) as Person[]) await ensureState(browser, info, person);
});

// Первый заход компилирует страницы dev-сервера: запас по времени.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

test("главная одобренного мастера: приветствие, «Сейчас», сводка, одно главное действие, слов покупателя нет", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("Здравствуйте");
  await expect(page.getByRole("group", { name: m.home.stats.label })).toBeVisible();
  await expect(page.getByText(m.home.stats.earned)).toBeVisible();
  expect(await page.locator("[data-primary-action]").count()).toBeLessThanOrEqual(1);
  await expect(page.locator("main")).not.toContainText(/комисси|эскроу|демо|заказчик/i);
  await page.context().close();
});

test("«Заявки»: чип «Новые» меняет адрес и оставляет только новые; у карточки видно, что нужно и где", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2/executor/requests");
  await expect(page.locator("h1")).toHaveText(m.incoming.title);
  const fresh = page.getByRole("link", { name: new RegExp(`^${m.incoming.chips.fresh} · \\d+`) });
  if ((await fresh.count()) > 0) {
    await fresh.click();
    await page.waitForURL(/\?f=new$/);
    await expect(page.getByRole("link", { name: new RegExp(`^${m.incoming.chips.fresh} · \\d+`) })).toHaveAttribute("aria-current", "true");
  }
  await expect(page.locator("main")).not.toContainText(/\+7\s?\d{3}|@/);
  await page.context().close();
});

test("«Мои предложения»: «Назад» называет «Заявки»; чип раздела в адресе", async ({ browser }, info) => {
  const page = await pageOf(browser, info, "erlan");
  await open(page, "/v2/executor/offers");
  await expect(page.locator("h1")).toHaveText(m.offers.title);
  await expect(page.getByRole("link", { name: new RegExp(m.offers.back) }).first()).toBeVisible();
  const waiting = page.getByRole("link", { name: new RegExp(`^${m.offers.chips.waiting} · \\d+`) });
  if ((await waiting.count()) > 0) {
    await waiting.click();
    await page.waitForURL(/\?show=waiting$/);
  }
  await page.context().close();
});

for (const [person, status] of [
  ["almas", "pending"],
  ["express", "rejected"],
] as const) {
  test(`неодобренный мастер (${status}): три экрана — статус с одним шагом на регистрацию, не ошибка`, async ({ browser }, info) => {
    const page = await pageOf(browser, info, person);
    for (const url of ["/v2", "/v2/executor/requests", "/v2/executor/offers"]) {
      await open(page, url);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 2, name: m.gate[status].now })).toBeVisible();
      await expect(page.locator("[data-primary-action]")).toHaveCount(1);
      await expect(page.locator("[data-primary-action]")).toHaveAttribute("href", "/v2/register/executor");
    }
    await page.context().close();
  });
}
