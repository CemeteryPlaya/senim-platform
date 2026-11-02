// Скриншоты мастера заявки по шагам (встреча 31.10, п. 1): проходит мастер как заказчик и снимает каждый экран.
// Запуск (dev-сервер с демо-данными, DEMO_MODE=true): BASE_URL=http://localhost:3120 node docs/design/screens/capture-wizard.mjs
// Создаёт черновик заявки у демо-персоны (не отправляет). Файлы: docs/design/screens/wizard-<шаг>-<ширина>.png.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3120";
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.dirname(fileURLToPath(import.meta.url));
const PERSONA = process.env.PERSONA ?? "Данияр Ахметов";
// Нижняя панель на снимке всей страницы легла бы поверх середины экрана — на снимках мастера её скрываем.
const HIDE_DEV = "nextjs-portal { display: none !important; } nav.shadow-bar { display: none !important; }";

const WIDTHS = [
  { label: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { label: "1280", viewport: { width: 1280, height: 800 }, mobile: false },
];

const choose = async (page, name) => page.getByRole("radio", { name }).locator("xpath=ancestor::label[1]").click();

async function shot(page, name, width) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: HIDE_DEV });
  await page.screenshot({ path: path.join(OUT, `wizard-${name}-${width.label}.png`), fullPage: true });
  process.stdout.write(`wizard-${name}-${width.label}.png\n`);
}

async function next(page, heading) {
  const before = page.url();
  await page.getByRole("button", { name: "Далее" }).click();
  await page.waitForURL((u) => u.href !== before, { timeout: 30_000 });
  await page.getByRole("heading", { level: 1, name: heading }).waitFor({ timeout: 30_000 });
}

const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: width.viewport, isMobile: width.mobile, hasTouch: width.mobile, locale: "ru-RU", timezoneId: "Asia/Almaty", deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${BASE}/demo`);
    await page.getByRole("button", { name: `Войти: ${PERSONA}` }).click();
    await page.waitForURL((u) => u.pathname !== "/demo");

    await page.goto(`${BASE}/requests/new`);
    await choose(page, "Кухня");
    await shot(page, "1-type", width);
    await next(page, "Какой примерно вид?");
    await choose(page, /Светлые цвета/);
    await shot(page, "2-style", width);
    await next(page, /Размеры|Снимите размеры сами/);
    await shot(page, "3-size", width);
    if (await page.getByLabel("Глубина, см").count()) {
      await page.getByLabel("Ширина, см").fill("320");
      await page.getByLabel("Высота, см").fill("240");
      await page.getByLabel("Глубина, см").fill("60");
    }
    await next(page, "Какой уровень?");
    await choose(page, /^Комфорт/);
    await page.getByText("Чем отличаются уровни?").click();
    await shot(page, "4-segment", width);
    await next(page, /Фото и описание/);
    await page.getByLabel("Опишите своими словами").fill("Угловая кухня до потолка, нужна посудомойка и много ящиков");
    await shot(page, "5-room", width);
    await page.getByRole("button", { name: "Далее" }).click();
    try {
      await page.waitForURL(/step=place/, { timeout: 30_000 });
    } catch {
      process.stderr.write(`онлайн-замер: нужен снимок стены — дальше не идём${String.fromCharCode(10)}`);
      await context.close();
      continue;
    }
    await page.getByLabel("Адрес или район").fill("Астана, ЖК Sat City, ул. Тестовая, 1");
    await shot(page, "6-place", width);
    await next(page, "Проверьте и отправьте");
    await shot(page, "7-send", width);
    await context.close();
  }
} finally {
  await browser.close();
}
