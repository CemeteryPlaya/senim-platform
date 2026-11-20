import { expect, test, type Page } from "@playwright/test";
import { ru } from "@/i18n/ru";
import { ADMIN, ADMIN_TOTP_SECRET, EXECUTORS, OPERATOR, OPERATOR_TOTP_SECRET } from "@/seed/data";
import { testIban } from "@/seed/kz-id";
import { DEFAULT_FURNITURE_TYPES } from "@/verticals/furniture/catalog";
import { passOperatorTotpV2 } from "../operator-support";
import { loginV2, open } from "../support";

/**
 * Админка администратора (набор flows: база e2e пересеяна, правка меняет запись справочника). Засеянный администратор входит
 * как все — номер, код с экрана, код из приложения (экран второго шага общий с оператором). Статистика → «Данные» →
 * FurnitureType: поиск, карточка, правка названия с тостом и строкой аудита `admin.record.updated`, затем название
 * возвращается (справочник нужен другим сценариям). Карточка ExecutorProfile засеянного мастера — без ИИН, IBAN, их
 * последних цифр и имён скрытых полей ни в тексте, ни в разметке страницы. Оператор (с 2FA) в админку не попадает.
 * Только flows-desktop: админка — экран компьютера, правка одна на пересев.
 */

const a = ru.app.admin;
const DESKTOP_ONLY = "админка — экран компьютера: сценарий только в flows-desktop";

/** Скрытые поля ExecutorProfile (ИИН/БИН, ИИН подписанта, IBAN): не приходят ни в текст, ни в данные страницы. */
const HIDDEN_FIELDS = ["binIinEnc", "binIinHash", "binIinLast4", "signerIinEnc", "signerIinHash", "payoutIbanEnc", "payoutIbanLast4"];

/**
 * Счёт выплаты мастера сида: testIban(n + 1), n — место в порядке регистрации (seed.ts: executorsByRegistration и
 * payoutIbanOf — сначала зарегистрированные раньше).
 */
function seedIbanOf(key: keyof typeof EXECUTORS): string {
  const order = Object.entries(EXECUTORS).sort((x, y) => y[1].registeredDaysAgo - x[1].registeredDaysAgo);
  return testIban(order.findIndex(([k]) => k === key) + 1);
}

/** Таблица модели с поиском: адрес из «Данных», затем поиск формой (как человек). */
async function searchTable(page: Page, model: string, q: string): Promise<void> {
  await open(page, "/v2/admin/data");
  await page.getByRole("link", { name: model, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: model })).toBeVisible();
  await page.getByRole("searchbox", { name: a.data.search }).fill(q);
  await page.getByRole("button", { name: a.data.searchAction, exact: true }).click();
  await page.waitForURL((u) => u.searchParams.get("q") === q);
}

/** Строка таблицы с текстом → карточка по ссылке-ключу; возвращает ключ записи. */
async function openRow(page: Page, model: string, text: string): Promise<string> {
  const row = page.getByRole("row").filter({ hasText: text });
  await expect(row).toHaveCount(1);
  const link = row.getByRole("link");
  const id = (await link.textContent())?.trim() ?? "";
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: model })).toBeVisible();
  await expect(page.getByText(id, { exact: true }).first()).toBeVisible();
  return id;
}

/** Правка поля `name` карточки → тост «Сохранено…», поле с новым значением после обновления экрана. */
async function rename(page: Page, value: string): Promise<void> {
  const field = page.getByLabel("name", { exact: true });
  await field.fill(value);
  await page.getByRole("button", { name: a.record.save, exact: true }).click();
  await expect(page.getByText(a.record.saved)).toBeVisible();
  await expect(field).toHaveValue(value);
}

test("администратор: вход с кодом из приложения, статистика, поиск, правка с аудитом, без ПДн мастера", async ({ page }, info) => {
  test.skip(info.project.name !== "flows-desktop", DESKTOP_ONLY);
  test.setTimeout(240_000);

  // ── 1. Вход: номер → код с экрана → код из приложения → дом администратора, статистика ──
  await loginV2(page, ADMIN.phone);
  await passOperatorTotpV2(page, ADMIN_TOTP_SECRET);
  await expect(page).toHaveURL(/\/v2\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: a.stats.title })).toBeVisible();
  await expect(page.getByText(a.stats.money.income, { exact: true })).toBeVisible();

  // ── 2. «Данные» → FurnitureType → поиск → карточка → правка названия ──
  // Сразу после второго шага оболочка ещё сосредоточенная (только «Выйти»): меню — после полной загрузки страницы.
  await open(page, "/v2/admin");
  await page.getByRole("link", { name: ru.app.shell.nav.data, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: a.data.title })).toBeVisible();
  await searchTable(page, "FurnitureType", "kitchen");
  const id = await openRow(page, "FurnitureType", "kitchen");
  // Название сида (не текущее значение поля: прогон, упавший между правками, не закрепит своё название).
  const original = DEFAULT_FURNITURE_TYPES.find((f) => f.slug === "kitchen")?.name ?? "";
  await expect(page.getByLabel("name", { exact: true })).toHaveValue(new RegExp(`^${original}`));
  // Строки аудита правок этой записи до правки (повторный прогон без пересева — прежние правки уже в журнале).
  const audit = page.getByRole("row").filter({ hasText: "admin.record.updated" });
  await searchTable(page, "AuditEvent", id);
  const before = await audit.count();
  await open(page, `/v2/admin/data/FurnitureType/${encodeURIComponent(id)}`);
  await rename(page, `${original} (e2e ${Date.now()})`);

  // Аудит правки: новая строка admin.record.updated по этой записи.
  await searchTable(page, "AuditEvent", id);
  await expect(audit).toHaveCount(before + 1);

  // Название — обратно (справочник читают другие сценарии); вторая правка — вторая строка аудита.
  await open(page, `/v2/admin/data/FurnitureType/${encodeURIComponent(id)}`);
  await rename(page, original);
  await searchTable(page, "AuditEvent", id);
  await expect(audit).toHaveCount(before + 2);

  // ── 3. Карточка ExecutorProfile засеянного мастера: нет ИИН, IBAN, их последних цифр и скрытых полей ──
  const erlan = EXECUTORS.erlan;
  await searchTable(page, "ExecutorProfile", erlan.legalName);
  await openRow(page, "ExecutorProfile", erlan.legalName);
  await expect(page.getByText(erlan.legalName, { exact: true }).first()).toBeVisible();
  const iin = erlan.person.iin;
  const iban = seedIbanOf("erlan");
  const text = await page.locator("main").innerText();
  for (const secret of [iin, iin.slice(-4), iban, iban.slice(-4)]) expect(text).not.toContain(secret);
  // Разметка и данные RSC (форма правки получает запись целиком): ни значений, ни имён скрытых полей, ни IBAN стенда.
  const html = await page.content();
  for (const secret of [iin, iban, ...HIDDEN_FIELDS]) expect(html).not.toContain(secret);
  expect(html).not.toMatch(/KZ\d{2}000DEMO/);
});

test("оператор (с кодом из приложения) в админку не попадает", async ({ page }, info) => {
  test.skip(info.project.name !== "flows-desktop", DESKTOP_ONLY);
  test.setTimeout(120_000);
  await loginV2(page, OPERATOR.phone);
  await passOperatorTotpV2(page, OPERATOR_TOTP_SECRET);
  for (const path of ["/v2/admin", "/v2/admin/data", "/v2/admin/data/FurnitureType", "/v2/admin/data/User"]) {
    await open(page, path);
    // Оболочка оператора на неперенесённом адресе — заглушка «раздел переносится» (страница админки отказала на сервере,
    // OperatorMoving её не показывает); ни экрана, ни данных админки ни в тексте, ни в разметке.
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveCount(1);
    await expect(title).not.toHaveText(new RegExp(`^(${a.stats.title}|${a.data.title}|FurnitureType|User)$`));
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    const html = await page.content();
    for (const text of [a.stats.lead, a.data.lead, a.stats.money.paid, ADMIN.phone]) expect(html).not.toContain(text);
  }
});
