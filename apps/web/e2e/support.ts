import { execFileSync } from "node:child_process";
import path from "node:path";
import { devices, expect, type Browser, type BrowserContext, type Locator, type Page, type Request, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { CLIENTS, EXECUTORS, OPERATOR, OPERATOR_TOTP_SECRET } from "@/seed/data";
import { TOTP_PERIOD_S, totpNow } from "./totp";

/**
 * Общие шаги e2e: люди сида, вход, пересев базы, подписи, деньги, оператор manual.
 * Селекторы — по ролям и подписям из `ru`: так тест заодно проверяет доступность.
 */

/** Люди сида (src/seed/data.ts): имя — как его видят на экране (у мастера — наименование). Телефон — в PERSONA_PHONE. */
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

/** Телефоны в том виде, как их вводит человек. Покупатели и мастера входят только по SMS-коду. */
export const PHONE = {
  daniyar: "+7 700 000 01 02",
  madina: "+7 700 000 01 03",
  timur: "+7 700 000 02 04",
  samat: "+7 700 000 02 08",
  zhanna: "+7 700 000 03 04",
} as const;

/** Точки адресов заявок сида (src/seed/data.ts, ADDR) и «далеко» — около 5 км к северу. */
export const POINT = {
  syganak12: { latitude: 51.128207, longitude: 71.430411 },
  far: { latitude: 51.175, longitude: 71.43 },
} as const;

/**
 * Свежие данные стенда. Сид при APP_ENV не prod сам очищает таблицы (reseedStand: ResetStand в identity, TRUNCATE …
 * RESTART IDENTITY), поэтому номера заявок и сделок — как в docs/agents/STAND_DATA.md. Только база «*e2e*».
 */
export function reseed(): void {
  const url = process.env.E2E_DATABASE_URL ?? "";
  if (!/e2e/i.test(new URL(url).pathname)) throw new Error("E2E_DATABASE_URL должна указывать на базу с «e2e» в имени");
  const bin = path.resolve("node_modules/.bin");
  const env = { ...process.env, DATABASE_URL: url, APP_ENV: "dev", PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "seed"], { env, stdio: "pipe" });
}

/** Телефон человека сида (E.164) по имени из `P`: вход — как у любого, по SMS-коду с экрана. */
const PERSONA_PHONE: Record<string, string> = {
  [P.dinara]: OPERATOR.phone,
  [P.aigerim]: CLIENTS.aigerim.phone,
  [P.daniyar]: CLIENTS.daniyar.phone,
  [P.madina]: CLIENTS.madina.phone,
  [P.erlan]: EXECUTORS.erlan.person.phone,
  [P.agash]: EXECUTORS.agash.person.phone,
  [P.qazaq]: EXECUTORS.qazaq.person.phone,
  [P.dala]: EXECUTORS.dala.person.phone,
  [P.kim]: EXECUTORS.kim.person.phone,
  [P.timur]: EXECUTORS.timur.person.phone,
  [P.asel]: EXECUTORS.asel.person.phone,
  [P.almas]: EXECUTORS.almas.person.phone,
};

/**
 * Вторая ступень входа оператора сида: код из приложения по известному секрету стенда (OPERATOR_TOTP_SECRET). Один код
 * принимается один раз: если шаг уже занят предыдущим входом, ждём следующий шаг (30 с) и повторяем.
 */
export async function passOperatorTotp(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/operator\/mfa/);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel("Код из приложения").fill(totpNow(OPERATOR_TOTP_SECRET));
    await page.getByRole("button", { name: "Войти в кабинет" }).click();
    const left = await page.waitForURL((u) => !u.pathname.startsWith("/operator/mfa"), { timeout: 8_000 }).then(
      () => true,
      () => false,
    );
    if (left) return;
    await expect(page.getByText(/уже использован/)).toBeVisible();
    await page.waitForTimeout((TOTP_PERIOD_S - ((Date.now() / 1000) % TOTP_PERIOD_S) + 1) * 1000);
  }
  throw new Error("Оператор сида не прошёл вторую ступень входа");
}

/** Вход человека сида: телефон → код с экрана → для оператора код из приложения (секрет стенда). Прежний вход сбрасывается. */
export async function loginAs(page: Page, name: string): Promise<void> {
  const phone = PERSONA_PHONE[name];
  if (!phone) throw new Error(`Нет телефона сида для «${name}»`);
  await loginByPhone(page, phone);
  if (phone === OPERATOR.phone) await passOperatorTotp(page);
}

/** Вход по SMS-коду (мок SMS у identity стенда: код показывается на экране входа). */
export async function loginByPhone(page: Page, phone: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Номер телефона").fill(phone);
  await page.getByRole("button", { name: "Получить код" }).click();
  const banner = page.getByText(/Ваш код — \d{6}/);
  const code = (await banner.textContent())?.match(/\d{6}/)?.[0];
  if (!code) throw new Error("Код не найден на экране входа");
  await page.getByLabel("Код из SMS").fill(code);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => u.pathname !== "/login");
}

/**
 * Экран согласия на обработку ПДн после входа новым номером: «Даю согласие» и переход дальше (на `next`). Люди сида
 * его не видят — у них засеяно согласие текущей редакции. Проверки самого экрана — в consent.spec.ts.
 */
export async function acceptConsent(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/consent\?next=/);
  await page.getByRole("button", { name: "Даю согласие" }).click();
  await page.waitForURL((u) => u.pathname !== "/consent");
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

/**
 * Узкий экран и крупный шрифт: на 320 px и 200 % страница не прокручивается вбок. Проверяет только горизонтальную
 * прокрутку; размер окна и шрифт после проверки возвращаются как были.
 */
export async function expectNoHorizontalScrollAt320And200(page: Page, path: string): Promise<void> {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(path);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.waitForTimeout(200);
  await expectNoHorizontalScroll(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  if (before) await page.setViewportSize(before);
}

/**
 * Одно заливное главное действие на экране (data-primary-action ставят Button, ButtonLink и SignLink варианта primary).
 * Считаются только видимые: кнопка «Да» закрытого окна подтверждения (ConfirmButton) лежит в DOM, но на экране её нет.
 */
export async function expectOnePrimary(page: Page): Promise<void> {
  await expect(page.getByRole("main").locator("[data-primary-action]:visible")).toHaveCount(1);
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
 * Отметка «Передача данных банку-партнёру» в «Что дальше» (мастер — до подписи оферты, покупатель — перед оплатой), если
 * её ещё нет: отметка сохраняется сразу, экран обновляется.
 */
export async function giveBankConsent(page: Page): Promise<void> {
  const box = nextStep(page).getByRole("checkbox", { name: "Даю согласие на передачу моих данных банку-партнёру для этой сделки" });
  if (!(await box.isVisible())) return;
  await box.check();
  await expect(nextStep(page).getByText("Согласие на передачу данных банку-партнёру дано")).toBeVisible();
}

/**
 * Подпись документа сделки: ссылка главного действия шага в StickyAction («Подписать оферту», «Подписать акт»,
 * «Подписать акт ЭЦП») ведёт к панели документа. Шаг 1 (если нужен) — собственноручно, «Напечатать имя»; шаг 2 — ЭЦП через мок eGov QR.
 * dblclick — двойное нажатие на каждой кнопке подписи. Возвращает панель документа.
 */
export async function signFromNextStep(page: Page, link: string, opts: { doubleClick?: boolean; expectHand?: boolean } = {}): Promise<Locator> {
  // Мастер подписывает оферту только после отметки о передаче данных банку-партнёру (P3).
  if (link === "Подписать оферту") await giveBankConsent(page);
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
