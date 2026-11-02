// Скриншоты ключевых экранов для сравнения с макетами основателей (docs/design/README.md).
// Запуск (dev-сервер с демо-данными уже работает, DEMO_MODE=true):
//   BASE_URL=http://localhost:3120 node docs/design/screens/capture.mjs
// Вход — демо-персонами через /demo. Файлы: docs/design/screens/<экран>-<ширина>.png.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3120";
const OUT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Экраны: кто входит (имя на кнопке «Войти: …» страницы /demo; null — гость), адрес, ссылка, по которой перейти
 * (open, then — имя ссылки), full — на телефоне вся страница. Номера заявок и сделок — из демо-сида.
 */
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const SCREENS = [
  { name: "landing", persona: null, url: "/" },
  { name: "client-home", persona: "Айгерим Сапарова", url: "/" },
  { name: "client-requests", persona: "Айгерим Сапарова", url: "/requests" },
  { name: "client-profile", persona: "Айгерим Сапарова", url: "/profile" },
  { name: "executor-home", persona: "Жумабаев Ерлан Серикович", url: "/" },
  { name: "executor-incoming", persona: "Жумабаев Ерлан Серикович", url: "/executor/requests" },
  { name: "ui-kit", persona: null, url: "/ui-kit" },
  // Экраны заказчика в новом стиле (встреча 31.10, п. 4): телефон — страница целиком, нижняя панель скрыта.
  { name: "inspiration", persona: "Айгерим Сапарова", url: "/inspiration", full: true },
  { name: "client-request-offers", persona: "Айгерим Сапарова", url: "/requests", open: /^Заявка №19:/, full: true },
  { name: "client-offer", persona: "Айгерим Сапарова", url: "/requests", open: /^Заявка №19:/, then: "Подробнее", full: true },
  { name: "client-request-contract", persona: "Данияр Ахметов", url: "/requests", open: /^Заявка №24:/, full: true },
  { name: "deal-client", persona: "Айгерим Сапарова", url: "/deals", open: /^Открыть: Сделка №11$/, full: true },
  { name: "deal-executor", persona: "Жумабаев Ерлан Серикович", url: "/deals", open: /^Открыть: Сделка №11$/, full: true },
  { name: "deal-done-photos", persona: "Данияр Ахметов", url: "/deals", open: /^Открыть: Сделка №7$/, full: true },
];

/** Значок инструментов разработчика Next в углу — не часть интерфейса. */
const HIDE_DEV = "nextjs-portal { display: none !important; }";
/** На снимке всей страницы закреплённая нижняя панель легла бы поверх середины — скрываем. */
const HIDE_BAR = "nav.shadow-bar { display: none !important; }";

const WIDTHS = [
  { label: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { label: "1280", viewport: { width: 1280, height: 800 }, mobile: false },
];

async function login(page, persona) {
  await page.context().clearCookies();
  if (!persona) return;
  await page.goto(`${BASE}/demo`);
  await page.getByRole("button", { name: `Войти: ${persona}` }).click();
  await page.waitForURL((u) => u.pathname !== "/demo");
}

const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: width.viewport, isMobile: width.mobile, hasTouch: width.mobile, locale: "ru-RU", timezoneId: "Asia/Almaty", deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const screen of SCREENS.filter((x) => !ONLY || ONLY.test(x.name))) {
      await login(page, screen.persona);
      await page.goto(`${BASE}${screen.url}`);
      if (screen.open) {
        await page.getByRole("link", { name: screen.open }).first().click();
        await page.waitForURL((u) => u.pathname !== screen.url);
      }
      if (screen.then) {
        const from = page.url();
        await page.getByRole("link", { name: screen.then }).first().click();
        await page.waitForURL((u) => u.href !== from);
      }
      await page.waitForLoadState("networkidle");
      const full = screen.full === true || !width.mobile;
      await page.addStyleTag({ content: full && width.mobile ? `${HIDE_DEV} ${HIDE_BAR}` : HIDE_DEV });
      // Телефон — первый экран, как в макетах (нижняя панель на своём месте); компьютер — страница целиком.
      await page.screenshot({ path: path.join(OUT, `${screen.name}-${width.label}.png`), fullPage: full });
      process.stdout.write(`${screen.name}-${width.label}.png\n`);
    }
    // Системный шрифт 200 %: главная заказчика и нижняя панель на телефоне.
    if (width.mobile && (!ONLY || ONLY.test("client-home"))) {
      await login(page, "Айгерим Сапарова");
      await page.goto(`${BASE}/`);
      await page.addStyleTag({ content: `html { font-size: 200% !important; } ${HIDE_DEV}` });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, "client-home-390-font200.png"), fullPage: false });
      process.stdout.write("client-home-390-font200.png\n");
    }
    await context.close();
  }
} finally {
  await browser.close();
}
