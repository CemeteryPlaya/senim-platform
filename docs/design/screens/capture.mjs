// Скриншоты ключевых экранов для сравнения с макетами основателей (docs/design/README.md).
// Запуск (dev-сервер с демо-данными уже работает, DEMO_MODE=true):
//   BASE_URL=http://localhost:3120 node docs/design/screens/capture.mjs
// Вход — демо-персонами через /demo. Файлы: docs/design/screens/<экран>-<ширина>.png.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3120";
const OUT = path.dirname(fileURLToPath(import.meta.url));

/** Экраны: кто входит (имя на кнопке «Войти: …» страницы /demo; null — гость) и какой адрес. */
const SCREENS = [
  { name: "landing", persona: null, url: "/" },
  { name: "client-home", persona: "Айгерим Сапарова", url: "/" },
  { name: "client-requests", persona: "Айгерим Сапарова", url: "/requests" },
  { name: "client-profile", persona: "Айгерим Сапарова", url: "/profile" },
  { name: "executor-home", persona: "Жумабаев Ерлан Серикович", url: "/" },
  { name: "executor-incoming", persona: "Жумабаев Ерлан Серикович", url: "/executor/requests" },
  { name: "ui-kit", persona: null, url: "/ui-kit" },
];

/** Значок инструментов разработчика Next в углу — не часть интерфейса. */
const HIDE_DEV = "nextjs-portal { display: none !important; }";

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
    for (const screen of SCREENS) {
      await login(page, screen.persona);
      await page.goto(`${BASE}${screen.url}`);
      await page.waitForLoadState("networkidle");
      await page.addStyleTag({ content: HIDE_DEV });
      // Телефон — первый экран, как в макетах (нижняя панель на своём месте); компьютер — страница целиком.
      await page.screenshot({ path: path.join(OUT, `${screen.name}-${width.label}.png`), fullPage: !width.mobile });
      process.stdout.write(`${screen.name}-${width.label}.png\n`);
    }
    // Системный шрифт 200 %: главная заказчика и нижняя панель на телефоне.
    if (width.mobile) {
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
