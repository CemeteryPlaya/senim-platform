import path from "node:path";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import { EXECUTORS, OPERATOR, OPERATOR_TOTP_SECRET } from "@/seed/data";
import { DEFAULT_FURNITURE_TYPES, SEGMENT_NAMES } from "@/verticals/furniture";
import { passOperatorTotpV2 } from "./operator-support";
import { assertSafeDatabase } from "./safe-database";
import { freshPhone, loginV2, open, passOnboarding } from "./support";

/**
 * Свой дизайн-проект в заявке — весь путь (спека 2026-11-19-request-design-project): новый покупатель прикладывает PDF на
 * шаге «Помещение» (без отметки о контактах шаг не сохраняется — ошибка у отметки) и отправляет заявку; засеянный мастер
 * сегмента «Комфорт» (Исп. №5, Ким) видит «Дизайн-проект, файл 1 (PDF)» во входящей заявке; засеянный оператор (вход с
 * кодом из приложения) открывает «Файлы заявки» формой «Открыть заявку» и скрывает файл; мастер файла больше не видит,
 * покупатель видит «Скрыт оператором». Данные не пересеваются: покупатель и заявка новые, меняется только их файл.
 * Номер заявки — чтением из базы e2e (только «senim_v2web_*»). Подписи — только из ru.
 */

const w = ru.app.requests.wizard;
const d = w.room.design;
const files = ru.app.operatorDisputes.requestFiles;
const KITCHEN = DEFAULT_FURNITURE_TYPES[0].name;
const PDF = path.join(__dirname, "fixtures", "design.pdf");
const MASTER = EXECUTORS.kim.person.phone;
const PDF_LABEL = d.pdf(1);

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function requestNumber(requestId: string): Promise<number> {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const { rows } = await db.query<{ number: number }>(`select number from "Request" where id = $1`, [requestId]);
    if (!rows[0]) throw new Error(`Заявки ${requestId} нет в базе e2e`);
    return rows[0].number;
  } finally {
    await db.end();
  }
}

async function pageAs(browser: Browser, info: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...info.project.use });
  return context.newPage();
}

test("дизайн-проект: покупатель прикладывает PDF, мастер видит, оператор скрывает — мастер не видит, покупатель видит пометку", async ({ page, browser }, info) => {
  // Три входа (покупатель, мастер, оператор с кодом из приложения) и первые сборки страниц dev-сервера.
  test.setTimeout(420_000);

  // 1. Покупатель: заявка с дизайн-проектом.
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  await open(page, "/v2/requests/new");
  await page.getByText(KITCHEN, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=segment/);
  await page.getByText(SEGMENT_NAMES.COMFORT, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=room/);
  const requestId = new URL(page.url()).searchParams.get("draft");
  expect(requestId).toBeTruthy();

  await page.locator('input[type="file"][accept*="application/pdf"]').setInputFiles(PDF);
  await expect(page.getByText(ru.app.kit.uploader.done)).toHaveCount(1, { timeout: 30_000 });
  // Без отметки о контактах шаг не сохраняется: ошибка у отметки, адрес не меняется.
  await button(page, w.next).click();
  await expect(page.getByText(ru.requests.validation.designContactsRequired)).toBeVisible();
  await expect(page).toHaveURL(/step=room/);
  await page.getByText(d.confirm, { exact: true }).click();
  await button(page, w.next).click();
  await page.waitForURL(/step=place/);

  await page.getByLabel(w.place.city, { exact: true }).fill("Астана");
  await page.getByLabel(w.place.address).fill("ул. Достык, 5");
  await button(page, w.next).click();
  await page.waitForURL(/step=send/);
  await button(page, w.submit).click();
  await page.waitForURL(new RegExp(`/v2/requests/${requestId}\\?sent=1`));
  const number = await requestNumber(requestId!);

  // 2. Мастер сегмента видит проект во входящей заявке.
  const master = await pageAs(browser, info);
  await loginV2(master, MASTER);
  await open(master, `/v2/executor/requests/${requestId}`);
  await expect(master.getByRole("link", { name: PDF_LABEL })).toBeVisible();

  // 3. Оператор: «Открыть заявку» на «Заявках без откликов» → «Файлы заявки №N» → «Скрыть».
  const operator = await pageAs(browser, info);
  await loginV2(operator, OPERATOR.phone);
  await passOperatorTotpV2(operator, OPERATOR_TOTP_SECRET);
  await open(operator, "/v2/operator/requests");
  await operator.getByLabel(files.open.number).fill(String(number));
  await button(operator, files.open.submit).click();
  await operator.waitForURL(new RegExp(`/v2/operator/requests/${number}$`));
  await expect(operator.getByRole("heading", { level: 1, name: files.title(number) })).toBeVisible();
  await expect(operator.getByRole("link", { name: files.pdf(1) })).toBeVisible();
  // Экран оператора: не шире окна (таблица прокручивается внутри своей области), главной кнопки нет.
  const overflow = await operator.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await operator.locator("[data-primary-action]:visible").count()).toBe(0);
  await operator.getByRole("button", { name: files.hideLabel(files.pdf(1)) }).click();
  await expect(operator.getByRole("button", { name: files.restoreLabel(files.pdf(1)) })).toBeVisible();
  await expect(operator.getByText(files.hidden, { exact: true })).toBeVisible();

  // 4. Мастер файла больше не видит; покупатель видит его с пометкой.
  await open(master, `/v2/executor/requests/${requestId}`);
  await expect(master.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(master.getByRole("link", { name: PDF_LABEL })).toHaveCount(0);
  await expect(master.getByText(ru.app.masterOffer.request.design.title)).toHaveCount(0);

  await open(page, `/v2/requests/${requestId}`);
  await expect(page.getByRole("link", { name: PDF_LABEL })).toBeVisible();
  await expect(page.getByText(d.hidden, { exact: true })).toBeVisible();

  await master.context().close();
  await operator.context().close();
});
