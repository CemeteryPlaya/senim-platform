import { execFileSync } from "node:child_process";
import path from "node:path";
import { devices, expect, type Browser, type BrowserContext, type Locator, type Page, type Request, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

/**
 * Общие шаги e2e: демо-персоны, пересев базы, подписи, деньги, оператор manual.
 * Селекторы — по ролям и подписям из `ru`: так тест заодно проверяет доступность.
 */

/** Демо-персоны: имя — как на кнопке «Войти: …» страницы /demo (у мастера — наименование). */
export const P = {
  dinara: "Динара Абенова", // оператор
  aigerim: "Айгерим Сапарова",
  daniyar: "Данияр Ахметов",
  madina: "Мадина Касымова",
  erlan: "Жумабаев Ерлан Серикович", // Исп. №3, Комфорт
  agash: "ТОО «Ағаш Шебер»", // Исп. №1, Премиум
  qazaq: "ТОО «Qazaq Wood»", // Исп. №2, Комфорт
  dala: "ИП Абдрахманов Нурлан Канатович", // Исп. №4, Комфорт; ещё и покупатель (ADR-004)
  kim: "ИП Ким Руслан Владимирович", // Исп. №5, Комфорт
  timur: "Оспанов Тимур Маратович", // Исп. №6, Эконом
  asel: "ИП Нурланова Асель Ерлановна", // Исп. №7, Премиум
  almas: "Тлеубаев Алмас Бауыржанович", // Исп. №10, регистрация PENDING
} as const;

/** Телефоны в том виде, как их вводит человек. Покупатели без демо-входа — только по SMS. */
export const PHONE = {
  daniyar: "+7 700 000 01 02",
  madina: "+7 700 000 01 03",
  timur: "+7 700 000 02 04",
  samat: "+7 700 000 02 08",
  zhanna: "+7 700 000 03 04",
} as const;

/** Точки адресов демо-заявок (src/demo/data.ts, ADDR) и «далеко» — около 5 км к северу. */
export const POINT = {
  demo12: { latitude: 51.128207, longitude: 71.430411 },
  far: { latitude: 51.175, longitude: 71.43 },
} as const;

/**
 * Свежие демо-данные. Сид при DEMO_MODE=true сам очищает таблицы (resetDemo, RESTART IDENTITY),
 * поэтому номера заявок и сделок — как в docs/agents/DEMO_DATA.md. Только база «*e2e*».
 */
export function reseed(): void {
  const url = process.env.E2E_DATABASE_URL ?? "";
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("E2E_DATABASE_URL должна указывать на базу с «e2e» в имени");
  const bin = path.resolve("node_modules/.bin");
  const env = { ...process.env, DATABASE_URL: url, DEMO_MODE: "true", PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "seed"], { env, stdio: "pipe" });
}

/** Вход демо-персоной одним нажатием (выход из прежней сессии — очисткой cookie). */
export async function loginAs(page: Page, name: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/demo");
  await page.getByRole("button", { name: `Войти: ${name}` }).click();
  await page.waitForURL((u) => u.pathname !== "/demo");
}

/** Вход по SMS-коду (SMS_PROVIDER=mock показывает код в демо-баннере). */
export async function loginByPhone(page: Page, phone: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Получить код" }).click();
  const banner = page.getByText(/Демо-режим: SMS не отправляется\. Ваш код — \d{6}/);
  const code = (await banner.textContent())?.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Код не найден в демо-баннере");
  await page.getByLabel("Код из SMS").fill(code);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

/**
 * Отдельный мобильный браузер участника (Pixel 7): свои cookie, своё место для GPS.
 * Опции проекта (baseURL, язык, часовой пояс) в созданный вручную контекст не переходят — передаём сами.
 */
export async function phone(browser: Browser, info: TestInfo, geo?: { latitude: number; longitude: number }): Promise<BrowserContext> {
  const { baseURL, locale, timezoneId } = info.project.use;
  return browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale,
    timezoneId,
    ...(geo ? { geolocation: { ...geo, accuracy: 20 }, permissions: ["geolocation"] } : {}),
  });
}

/** Выбор карточки RadioCards: radio визуально скрыт, человек нажимает на карточку-label. */
export async function choose(radio: Locator): Promise<void> {
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

/** Открыть сделку по номеру из списка «Сделки» текущего пользователя. */
export async function openDeal(page: Page, n: number): Promise<string> {
  await page.goto("/deals");
  await page.getByRole("link", { name: `Открыть: Сделка №${n}`, exact: true }).click();
  await page.waitForURL(/\/deals\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: `Сделка №${n}` })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Открыть заявку покупателя по номеру из «Мои заявки». */
export async function openMyRequest(page: Page, n: number): Promise<string> {
  await page.goto("/requests");
  await page.getByRole("link", { name: new RegExp(`^Заявка №${n}:`) }).click();
  await page.waitForURL(/\/requests\/[^/?]+/);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Заявка №${n}:`) })).toBeVisible();
  return new URL(page.url()).pathname;
}

/** Блок «Что дальше» на экране сделки. */
export function nextStep(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Что дальше", exact: true }) });
}

/**
 * Единственное действие текущего шага сделки (StickyAction): на телефоне закреплено у нижнего края,
 * на десктопе — в правой колонке под деньгами. Формы шага (сдача работы, отзыв) остаются в «Что дальше».
 */
export function stepAction(page: Page): Locator {
  return page.getByRole("main").locator("[data-sticky-action]");
}

/** Нет горизонтальной прокрутки страницы. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Узкий экран и крупный шрифт: 320 px и 200 % — страница не уезжает вбок. */
export async function expectFitsAt320And200(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(path);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.waitForTimeout(200);
  await expectNoHorizontalScroll(page);
}

/** Блок денег — первый блок карточки сделки (заголовок «Деньги» для диктора). */
export function moneyBlock(page: Page): Locator {
  return page.getByRole("region", { name: "Деньги", exact: true });
}

/** Статус сделки в шапке экрана. */
export async function expectDealStatus(page: Page, status: string): Promise<void> {
  await expect(page.getByRole("main").getByText(status, { exact: true }).first()).toBeVisible();
}

// ── Деньги: формулы ТЗ п. 6 как независимый оракул (не импорт computeDealMoney) ──

export type Money = { price: bigint; protection: bigint; buyerTotal: bigint; payout: bigint; guarantee: bigint; income: bigint };

/** Цена X в тенге → тиыны по ТЗ: защита ⌈2%⌉, выплата ⌊96%⌋, доход = оплачено − выплата. */
export function dealMoney(priceKzt: number | bigint): Money {
  const price = BigInt(priceKzt) * 100n;
  const protection = (price * 2n + 99n) / 100n;
  const payout = (price * 96n) / 100n;
  const buyerTotal = price + protection;
  return { price, protection, buyerTotal, payout, guarantee: price - payout, income: buyerTotal - payout };
}

/** Сумма в тиынах как на экране («1 530 000 ₸», «1 234,56 ₸») — регулярное выражение, любые пробелы между разрядами. */
export function amount(tiyn: bigint): RegExp {
  const whole = (tiyn / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const cents = tiyn % 100n;
  const text = `${whole}${cents === 0n ? "" : `,${cents.toString().padStart(2, "0")}`} ₸`;
  const source = text.replace(/ /g, "[\\s\\u00a0\\u202f]*");
  return new RegExp(`(?<![\\d,])${source}`);
}

// ── Подписи ──

/**
 * Подпись документа сделки: ссылка главного действия шага в StickyAction («Подписать оферту», «Подписать акт»,
 * «Подписать акт ЭЦП») ведёт к панели документа. Шаг 1 (если нужен) — собственноручно, «Напечатать имя»; шаг 2 — ЭЦП через мок eGov QR.
 * dblclick — двойное нажатие на каждой кнопке подписи. Возвращает панель документа.
 */
export async function signFromNextStep(page: Page, link: string, opts: { doubleClick?: boolean; expectHand?: boolean } = {}): Promise<Locator> {
  const go = stepAction(page).getByRole("link", { name: link, exact: true });
  const anchor = await go.getAttribute("href");
  if (!anchor?.startsWith("#doc-")) throw new Error(`Неожиданная ссылка на документ: ${anchor}`);
  await go.click();
  const panel = page.locator(anchor);
  const press = (button: Locator) => (opts.doubleClick ? button.dblclick() : button.click());

  const hand = panel.getByRole("region", { name: "Шаг 1. Собственноручная подпись" });
  if (opts.expectHand ?? true) {
    await expect(hand).toBeVisible();
    await hand.getByRole("button", { name: "Напечатать имя" }).click();
    const name = hand.getByLabel("Ваше имя полностью");
    if ((await name.inputValue()).trim().length < 2) await name.fill("Тестовый Подписант");
    await press(hand.getByRole("button", { name: "Подписать", exact: true }));
    await expect(hand).toBeHidden();
  } else {
    await expect(hand).toHaveCount(0);
  }

  const ecp = panel.getByRole("region", { name: "Шаг 2. Подпись ЭЦП" });
  await expect(ecp.getByRole("radio", { name: /eGov Mobile/ })).toBeChecked();
  await press(ecp.getByRole("button", { name: "Подписать ЭЦП" }));
  await expect(ecp.getByRole("img", { name: "QR-код для подписи в eGov Mobile" })).toBeVisible();
  await press(ecp.getByRole("button", { name: "Я подписал — проверить" }));
  // Итог объявляется в панели документа (шаг ЭЦП к этому времени сменяется «Вы поставили все свои подписи»).
  await expect(panel.getByRole("status").filter({ hasText: /^(Подпись принята|Документ подписан всеми сторонами)$/ })).toBeVisible();
  return panel;
}

// ── Оператор: операции manual ──

/** Скан банковского документа — настоящий PDF (сервер проверяет формат). */
export async function scanPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText("TEST BANK DOCUMENT", { x: 20, y: 100, size: 14 });
  return Buffer.from(await doc.save());
}

/** Карточка ждущей операции в очереди «Деньги в банке»: вид операции + сделка. */
export function operationCard(page: Page, type: string, dealNumber: number): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: type, exact: true }) })
    .filter({ has: page.getByRole("link", { name: new RegExp(`^Сделка №${dealNumber}:`) }) });
}

/**
 * Оператор подтверждает операцию номером, датой (по умолчанию сегодня) и сканом банковского документа.
 * confirm — подпись кнопки (то, что сделал банк). dblclick — двойное нажатие на подтверждение.
 */
export async function confirmOperation(page: Page, o: { type: string; deal: number; confirm: string; docNumber: string; doubleClick?: boolean }): Promise<Locator> {
  await page.goto("/operator/money");
  const card = operationCard(page, o.type, o.deal);
  await expect(card).toHaveCount(1);
  await card.getByLabel("Номер банковского документа").fill(o.docNumber);
  await card.getByLabel("Скан банковского документа").setInputFiles({ name: `${o.docNumber}.pdf`, mimeType: "application/pdf", buffer: await scanPdf() });
  const button = card.getByRole("button", { name: o.confirm, exact: true });
  if (o.doubleClick) await button.dblclick();
  else await button.click();
  // Ждём ответ сервера: уход со страницы раньше оборвал бы запрос. Подтверждённая операция уходит из очереди.
  await expect(page.getByRole("status").filter({ hasText: "Операция подтверждена" })).toBeVisible();
  await expect(card).toHaveCount(0);
  return card;
}

/** Ждущие операции сделки в очереди оператора. */
export async function pendingOperations(page: Page, dealNumber: number): Promise<Locator> {
  await page.goto("/operator/money");
  // Карточка операции — пункт с заголовком; строки meta внутри карточки — тоже пункты списка, их не считаем.
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 2 }) })
    .filter({ has: page.getByRole("link", { name: new RegExp(`^Сделка №${dealNumber}:`) }) });
}

// ── История денег ──

/** Строки «Истории денег» (тап по блоку денег): вид операции, сумма, статус. */
export async function openMoneyHistory(page: Page, dealPath: string): Promise<Locator> {
  await page.goto(`${dealPath}/money`);
  await expect(page.getByRole("heading", { level: 1, name: "История денег" })).toBeVisible();
  return page.getByRole("main").getByRole("listitem");
}

export function historyRow(rows: Locator, type: string): Locator {
  return rows.filter({ has: rows.page().getByText(type, { exact: true }) });
}

// ── Сдача работы ──

/** Мастер сдаёт работу: одно фото результата, геолокация — из контекста браузера. */
export async function submitReady(page: Page): Promise<void> {
  const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#b07a4a" } }).jpeg().toBuffer();
  const chooser = page.waitForEvent("filechooser");
  await nextStep(page).getByRole("button", { name: /^Загрузить фото/ }).click();
  await (await chooser).setFiles({ name: "result.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(nextStep(page).getByRole("progressbar")).toHaveCount(0);
  await nextStep(page).getByRole("button", { name: "Сдать работу" }).click();
  await expect(page.getByRole("region", { name: "Сдача работы" })).toBeVisible();
}


// ── Повторные запросы ──

/**
 * Запрос Server Action, ушедший во время действия (заголовок Next-Action). Его можно отправить ещё раз
 * тем же сеансом (page.request.fetch) — так проверяем «повторная отправка формы — одна операция».
 */
export async function captureAction(page: Page, act: () => Promise<void>): Promise<Request> {
  const sent: Request[] = [];
  const listen = (r: Request) => {
    if (r.method() === "POST" && r.headers()["next-action"]) sent.push(r);
  };
  page.on("request", listen);
  try {
    await act();
    await expect.poll(() => sent.length).toBeGreaterThan(0);
  } finally {
    page.off("request", listen);
  }
  return sent[0];
}

/** Отправить запрос ещё раз. Сервер не должен падать (5xx) и не должен создать второй эффект. */
export async function replay(page: Page, request: Request): Promise<void> {
  const res = await page.request.fetch(request);
  expect(res.status(), `повтор ${request.url()}`).toBeLessThan(500);
}
