// Скриншоты экранов исполнителя, замерщика и оператора в новом стиле (docs/design/README.md).
// Запуск (dev-сервер с демо-данными уже работает, DEMO_MODE=true):
//   BASE_URL=http://localhost:3125 node docs/design/screens/capture-roles.mjs
// Вход — демо-персонами через /demo. Экран, адрес которого зависит от сида (cuid), открывается
// нажатием на ссылку по имени (open). Файлы: docs/design/screens/<экран>-<ширина>.png.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3125";
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.dirname(fileURLToPath(import.meta.url));

const ERLAN = "Жумабаев Ерлан Серикович"; // Исп. №3: сделки №11 и №14, отклики, портфолио
const KIM = "ИП Ким Руслан Владимирович"; // Исп. №5: ещё не откликался на тендер №19
const NURLAN = "ИП Абдрахманов Нурлан Канатович"; // Исп. №4: замер по №17 назначен

/** Экраны: кто входит (имя на кнопке «Войти: …» страницы /demo), адрес и, если нужно, ссылка для перехода. */
const SCREENS = [
  { name: "executor-finance", persona: ERLAN, url: "/executor/finance" },
  { name: "executor-incoming", persona: ERLAN, url: "/executor/requests" },
  { name: "executor-request-offer", persona: KIM, url: "/executor/requests", open: /^Заявка №19:/ },
  { name: "executor-request-measure", persona: NURLAN, url: "/executor/measurements?show=upcoming", open: /^Заявка №17:/ },
  { name: "executor-offers", persona: ERLAN, url: "/executor/offers" },
  { name: "executor-measurements", persona: ERLAN, url: "/executor/measurements" },
  { name: "executor-portfolio", persona: ERLAN, url: "/executor/portfolio" },
  { name: "executor-profile", persona: ERLAN, url: "/executor/profile" },
  { name: "measurer-home", persona: "Нуржан Сейтказин", url: "/measurer" },
  { name: "measurer-visit", persona: "Нуржан Сейтказин", url: "/measurer", open: /^Заявка №\d+:/ },
  { name: "operator-home", persona: "Динара Абенова", url: "/operator" },
  { name: "operator-executors", persona: "Динара Абенова", url: "/operator/executors" },
];

/** Значок инструментов разработчика Next в углу — не часть интерфейса. */
const HIDE_DEV = "nextjs-portal { display: none !important; }";

const WIDTHS = [
  { label: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { label: "1280", viewport: { width: 1280, height: 800 }, mobile: false },
];

async function login(page, persona) {
  await page.context().clearCookies();
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
      if (screen.open) {
        await page.getByRole("link", { name: screen.open }).first().click();
        await page.waitForURL((u) => u.pathname !== new URL(screen.url, BASE).pathname);
      }
      await page.waitForLoadState("networkidle");
      await page.addStyleTag({ content: HIDE_DEV });
      // Телефон — первый экран, как в макетах (нижняя панель на своём месте); компьютер — страница целиком.
      await page.screenshot({ path: path.join(OUT, `${screen.name}-${width.label}.png`), fullPage: !width.mobile });
      process.stdout.write(`${screen.name}-${width.label}.png\n`);
    }
    // Системный шрифт 200 %: «Финансы» исполнителя на телефоне.
    if (width.mobile) {
      await login(page, ERLAN);
      await page.goto(`${BASE}/executor/finance`);
      await page.addStyleTag({ content: `html { font-size: 200% !important; } ${HIDE_DEV}` });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, "executor-finance-390-font200.png"), fullPage: false });
      process.stdout.write("executor-finance-390-font200.png\n");
    }
    await context.close();
  }
} finally {
  await browser.close();
}
