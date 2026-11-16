import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { OPERATOR, OPERATOR_TOTP_SECRET } from "@/seed/data";
import { passOperatorTotpV2 } from "./operator-support";
import { loginV2, open } from "./support";

/**
 * Оператор в v2 (этап 5): вход засеянным оператором как у всех — номер, код с экрана, затем код из приложения по секрету
 * стенда (исключений 2FA нет). Дальше только чтение: каждый раздел меню открывается своей страницей v2 (не заглушкой
 * «раздел переносится»), с заголовком, не шире окна (таблицы прокручиваются внутри своей области) и не больше чем с одной
 * главной кнопкой. Данные не меняются: проекты mobile и desktop, без пересева.
 */

/** Разделы меню оператора (как в `operatorNav`): путь и заголовок страницы. Цены материалов — за флагом, здесь не проверяются. */
const SECTIONS: readonly string[] = [
  "/v2/operator",
  "/v2/operator/money",
  "/v2/operator/kyc",
  "/v2/operator/consents",
  "/v2/operator/executors",
  "/v2/operator/disputes",
  "/v2/operator/requests",
  "/v2/operator/deals",
  "/v2/operator/income",
  "/v2/operator/report",
  "/v2/operator/audit",
  "/v2/operator/furniture-types",
  "/v2/operator/settings",
];

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await loginV2(page, OPERATOR.phone);
  await passOperatorTotpV2(page, OPERATOR_TOTP_SECRET);
  await expect(page).toHaveURL(/\/v2\/operator\/?$/);
});

test.afterAll(async () => {
  await context.close();
});

test("вход оператора требует код из приложения: без него кабинет не открывается", async ({ browser }) => {
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await loginV2(other, OPERATOR.phone);
  await expect(other).toHaveURL(/\/v2\/operator\/mfa/);
  await open(other, "/v2/operator/money");
  await expect(other).toHaveURL(/\/v2\/operator\/mfa/);
  await fresh.close();
});

for (const path of SECTIONS) {
  test(`${path}: страница v2 с заголовком, не шире окна, не больше одной главной кнопки`, async () => {
    await open(page, path);
    await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}\\/?(\\?.*)?$`));
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    // Не заглушка «раздел переносится».
    await expect(main.getByText(ru.app.shell.movingTitle)).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await page.locator("[data-primary-action]:visible").count()).toBeLessThanOrEqual(1);
  });
}
