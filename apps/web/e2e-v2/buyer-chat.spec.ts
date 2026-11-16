import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Cookie, type Page } from "@playwright/test";
import { Client } from "pg";
import { ru } from "@/i18n/ru";
import { assertSafeDatabase } from "./safe-database";
import { seedBuyerState } from "./offers";
import { freshPhone, loginV2, open, passOnboarding } from "./support";


/**
 * Чаты покупателя (/v2/chats, /v2/chats/<id>) глазами засеянного покупателя Айгерим: список → диалог → сообщение; маска
 * телефона и ссылки до оферты; двойная отправка — одно сообщение; прокрутка длинной переписки (открытие у последнего
 * сообщения, окно не «прыгает», новое сообщение, телефон — прокручивается страница, компьютер — лента); поле растёт до
 * пяти строк; опрос подтягивает сообщение мастера без перезагрузки и молчит на скрытой вкладке.
 * Вход засеянным человеком — один раз на файл (по коду с экрана); сессия кладётся в куки каждого теста.
 * Меняет данные стенда только сообщениями чата.
 */

const t = ru.app.chat;
const kit = ru.app.kit.chat;

const STATE = path.join(tmpdir(), "senim-e2e-v2", "h1-chat.json");
/** Состояние входа живёт часы: у стенда лимит кодов на номер, поэтому вход повторяется, только если файла нет или он старый. */
const STATE_TTL_MS = 6 * 3600_000;

let cookies: Cookie[] = [];

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  let fresh = false;
  try {
    fresh = Date.now() - statSync(STATE).mtimeMs < STATE_TTL_MS;
  } catch {
    // файла нет
  }
  if (!fresh) await seedBuyerState(browser, baseURL, "h1-chat.json");
  cookies = (JSON.parse(readFileSync(STATE, "utf8")) as { cookies: Cookie[] }).cookies;
});

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await context.addCookies(cookies);
});

const log = (page: Page) => page.getByRole("log", { name: t.room.log });
const field = (page: Page) => page.getByLabel(t.room.composerLabel);
const send = (page: Page) => page.getByRole("button", { name: kit.send, exact: true });

/** Первый диалог списка (самый свежий) и его адрес. */
async function firstDialog(page: Page): Promise<string> {
  await open(page, "/v2/chats");
  const link = page.locator('main a[href^="/v2/chats/"]').first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("в списке нет диалога");
  return href;
}

async function expectScreenRules(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.locator("[data-primary-action]").count()).toBe(0);
}

/** Сообщение в поле и отправка; ждём, пока оно появится в ленте. */
async function say(page: Page, text: string, shown: string | RegExp = text): Promise<void> {
  await field(page).fill(text);
  await send(page).click();
  await expect(log(page).getByText(shown).last()).toBeVisible();
  await expect(field(page)).toHaveValue("");
}

/** Метка маски контактов модуля (companies/mask.ts). */
const MASK = ru.companies.chat.maskPlaceholder;

const LONG = "Столешницу предлагаю компакт-плиту двенадцать миллиметров: она тоньше и прочнее обычной, а фасады можно сделать в эмали любого цвета.";

test("список → диалог: собеседник, «Назад: Чаты», системная строка, один h1, без главного действия", async ({ page }) => {
  await open(page, "/v2/chats");
  await expect(page.getByRole("heading", { level: 1, name: t.list.title })).toBeVisible();
  await expectScreenRules(page);
  const main = await page.getByRole("main").innerText();
  expect(main).toMatch(/Исполнитель №\d+/);

  const href = await firstDialog(page);
  await page.locator(`main a[href="${href}"]`).click();
  await page.waitForURL(new RegExp(`${href}$`));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Исполнитель №\d+/);
  await expect(page.getByRole("link", { name: new RegExp(t.room.back) }).first()).toBeVisible();
  await expect(log(page).getByText(t.room.hiddenSystem)).toBeVisible();
  await expectScreenRules(page);

  // «Почему?» — пояснение: шторка на телефоне, поповер на компьютере.
  await page.getByRole("button", { name: t.room.why }).click();
  await expect(page.getByText(t.room.whyBody)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(t.room.whyBody)).toBeHidden();
});

test("маска: телефон и ссылка на мессенджер до оферты заменяются; двойная отправка — одно сообщение", async ({ page }) => {
  const href = await firstDialog(page);
  await open(page, href);
  const marker = `Маска ${Date.now()}`;
  await field(page).fill(`${marker} мой номер +7 701 555 44 33, пишите https://t.me/some_master`);
  await send(page).dblclick();
  await expect(log(page).getByText(marker)).toBeVisible();
  const mine = log(page).locator("article", { hasText: marker });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText(MASK);
  await expect(mine).not.toContainText("555 44 33");
  await expect(mine).not.toContainText("t.me");

  // После перезагрузки — то же: одно сообщение, исходного номера в БД нет.
  await open(page, href);
  await expect(log(page).locator("article", { hasText: marker })).toHaveCount(1);
  expect(await log(page).innerText()).not.toContain("555 44 33");
});

test("поле растёт до пяти строк, дальше прокрутка", async ({ page }, info) => {
  const href = await firstDialog(page);
  await open(page, href);
  const heights: number[] = [];
  for (let lines = 1; lines <= 7; lines += 1) {
    await field(page).fill(Array.from({ length: lines }, (_, i) => `строка ${i + 1}`).join("\n"));
    heights.push(await field(page).evaluate((node) => node.getBoundingClientRect().height));
  }
  info.annotations.push({ type: "высота поля по числу строк", description: heights.map((h) => h.toFixed(0)).join(", ") });
  for (let i = 1; i < 5; i += 1) expect(heights[i]).toBeGreaterThan(heights[i - 1] + 10);
  expect(heights[5]).toBeCloseTo(heights[4], 0);
  expect(heights[6]).toBeCloseTo(heights[4], 0);
  const scrollable = await field(page).evaluate((node) => node.scrollHeight > node.clientHeight);
  expect(scrollable).toBe(true);

});

test("длинная переписка: открывается у последнего сообщения, окно не прыгает; новое сообщение прокручивает; опрос подтягивает ответ мастера", async ({ page }, info) => {
  const href = await firstDialog(page);
  await open(page, href);
  const mobile = info.project.name === "mobile";

  // Длинная переписка — больше экрана (отправляем, пока не наберётся).
  const run = Date.now();
  for (let i = 1; i <= 14; i += 1) await say(page, `Сообщение ${run}-${i}. ${LONG}`, `Сообщение ${run}-${i}.`);

  await open(page, href);
  const lastText = `Сообщение ${run}-14.`;
  await expect(log(page).getByText(lastText)).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[role="log"]');
      const lastArticle = [...document.querySelectorAll('[role="log"] article')].at(-1);
      const rect = lastArticle?.getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        docHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        logScrollTop: Math.round(node?.scrollTop ?? -1),
        logClient: node?.clientHeight ?? -1,
        logScrollHeight: node?.scrollHeight ?? -1,
        lastBottom: Math.round(rect?.bottom ?? -1),
      };
    });

  await page.waitForTimeout(600);
  const a = await measure();
  await page.waitForTimeout(1500);
  const b = await measure();
  info.annotations.push({ type: `открытие, ${info.project.name}`, description: JSON.stringify({ a, b }) });
  // Окно не «прыгает»: после раскладки положение не меняется.
  expect(b.scrollY).toBe(a.scrollY);
  expect(b.logScrollTop).toBe(a.logScrollTop);
  if (mobile) {
    // Телефон: прокручивается страница (лента растёт в потоке), последнее сообщение на экране над полем ввода.
    expect(a.docHeight).toBeGreaterThan(a.innerHeight * 1.5);
    expect(a.scrollY).toBeGreaterThan(0);
    expect(a.scrollY + a.innerHeight).toBeGreaterThanOrEqual(a.docHeight - 40);
    expect(a.lastBottom).toBeLessThanOrEqual(a.innerHeight);
    expect(a.logScrollTop).toBe(0);
  } else {
    // Компьютер: прокручивается сама лента, окно остаётся на месте.
    expect(a.scrollY).toBe(0);
    expect(a.logScrollHeight).toBeGreaterThan(a.logClient + 100);
    expect(a.logScrollTop + a.logClient).toBeGreaterThanOrEqual(a.logScrollHeight - 30);
  }

  // Новое сообщение (человек внизу) — остаёмся внизу, окно само не двигается (до отправки поле ввода уже в поле зрения).
  const fresh = `Ещё одно ${run}`;
  await field(page).fill(fresh);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  await send(page).click();
  await expect(log(page).getByText(fresh)).toBeVisible();
  await page.waitForTimeout(800);
  const c = await measure();
  info.annotations.push({ type: `новое сообщение, ${info.project.name}`, description: JSON.stringify({ before, ...c }) });
  if (mobile) expect(c.scrollY + c.innerHeight).toBeGreaterThanOrEqual(c.docHeight - 40);
  else {
    expect(c.scrollY).toBe(before);
    expect(c.logScrollTop + c.logClient).toBeGreaterThanOrEqual(c.logScrollHeight - 30);
  }

  // Опрос: сообщение мастера, записанное в базу, появляется без перезагрузки за ~5 с.
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const offerId = href.split("/").at(-1)!;
  const db = new Client({ connectionString: url });
  await db.connect();
  const reply = `Ответ мастера ${run}`;
  try {
    await db.query(
      `insert into "Message" (id, "offerId", "senderId", body, "wasMasked", "createdAt")
       select 'e2e' || md5(random()::text), o.id, e."userId", $2, false, now()
         from "Offer" o join "ExecutorProfile" e on e.id = o."executorId" where o.id = $1`,
      [offerId, reply],
    );
  } finally {
    await db.end();
  }
  await expect(log(page).getByText(reply)).toBeVisible({ timeout: 12_000 });
});

test("компьютер 1280×800: поле ввода видно без прокрутки страницы, документ не выше окна", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "высота окна ленты — токен компьютера");
  await page.setViewportSize({ width: 1280, height: 800 });
  const href = await firstDialog(page);
  await open(page, href);
  const box = await field(page).boundingBox();
  const metrics = await page.evaluate("({ doc: document.documentElement.scrollHeight, win: window.innerHeight, y: window.scrollY })") as { doc: number; win: number; y: number };
  info.annotations.push({ type: "1280×800", description: JSON.stringify({ fieldBottom: Math.round((box?.y ?? 0) + (box?.height ?? 0)), ...metrics }) });
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800);
  expect(metrics.doc).toBeLessThanOrEqual(metrics.win + 2);
  expect(metrics.y).toBe(0);
});

test("до оферты кнопки вложения нет, а «Почему?» объясняет, что фото — после оферты", async ({ page }) => {
  // У засеянного покупателя диалоги с перепиской — по предложениям (оферты нет): фото в чат здесь недоступны.
  // Отправка фото после оферты — интеграционными тестами (companies/chat-attachments, v2/chats/chats.int).
  const href = await firstDialog(page);
  await open(page, href);
  await expect(page.getByRole("button", { name: kit.attach, exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: t.room.why }).click();
  await expect(page.getByText(/фото в чат можно будет отправлять/)).toBeVisible();
});

test("колонка на высоту окна: поле ввода видно, страница не прокручивается (800 и 720; шрифт 100 % и 150 %)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "высота ленты — устройство компьютера");
  const href = await firstDialog(page);
  await open(page, href);
  const rows: string[] = [];
  for (const height of [800, 720]) {
    for (const scale of ["100%", "150%"]) {
      await page.setViewportSize({ width: 1280, height });
      await page.addStyleTag({ content: `html { font-size: ${scale} !important; }` });
      await page.waitForTimeout(500);
      const m = (await page.evaluate(
        "(function(){var f=document.querySelector('textarea').getBoundingClientRect();var h1=document.querySelector('h1');var lh=parseFloat(getComputedStyle(h1).lineHeight);return {doc:document.documentElement.scrollHeight,win:window.innerHeight,fieldBottom:Math.round(f.bottom),h1Lines:Math.round(h1.getBoundingClientRect().height/lh),logH:Math.round(document.querySelector('[role=log]').clientHeight),y:Math.round(window.scrollY)}})()",
      )) as { doc: number; win: number; fieldBottom: number; h1Lines: number; logH: number; y: number };
      rows.push(`${height} ${scale}: ${JSON.stringify(m)}`);
      expect(m.fieldBottom, `${height} ${scale}`).toBeLessThanOrEqual(m.win);
      expect(m.doc, `${height} ${scale}`).toBeLessThanOrEqual(m.win + 2);
      expect(m.y).toBe(0);
    }
  }
  info.annotations.push({ type: "колонка на высоту окна", description: rows.join(" | ") });
});

test("адреса фото в ленте не меняются между опросами", async ({ page }) => {
  const href = await firstDialog(page);
  await open(page, href);
  const img = log(page).locator("img").first();
  test.skip((await img.count()) === 0, "в диалоге нет фото (сид пересеян)");
  const before = await img.getAttribute("src");
  let polls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) polls += 1;
  });
  await expect.poll(() => polls, { timeout: 16_000 }).toBeGreaterThanOrEqual(2);
  expect(await img.getAttribute("src")).toBe(before);
});

test("опрос молчит на скрытой вкладке и возобновляется при возврате", async ({ page }) => {
  const href = await firstDialog(page);
  let polls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) polls += 1;
  });
  await open(page, href);
  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  await setVisibility("hidden");
  const before = polls;
  await page.waitForTimeout(11_000);
  expect(polls - before).toBe(0);
  await setVisibility("visible");
  await expect.poll(() => polls - before, { timeout: 8_000 }).toBeGreaterThan(0);
});

test("чужой и несуществующий диалог — 404 одинаково", async ({ page }) => {
  for (const id of ["no-such-offer", "cmx0000000000000000000000"]) {
    const response = await page.goto(`/v2/chats/${id}`);
    expect(response?.status()).toBe(404);
  }
});

test("пустой список: новый человек видит обучающий экран без кнопки", async ({ page, context }) => {
  await context.clearCookies();
  await loginV2(page, freshPhone().typed);
  await passOnboarding(page);
  await open(page, "/v2/chats");
  await expect(page.getByText(t.list.emptyTitle)).toBeVisible();
  await expectScreenRules(page);
});
