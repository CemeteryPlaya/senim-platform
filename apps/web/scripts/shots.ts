// Снимки страниц нового интерфейса.
//
//   npx tsx scripts/shots.ts v2 v2/ui-kit [--out <папка>]
//
// Для каждого пути: компьютер — <имя>-desktop-{light,dark}.png (страница целиком); телефон —
// <имя>-mobile-{light,dark}.png (страница целиком) и <имя>-mobile-{light,dark}-fold.png (только первый экран).
// Файлы — в test-results/shots/ (или в --out).
//
// Пути пишите БЕЗ ведущего «/» (v2, v2/ui-kit). Корень сайта снимается аргументом "" или «/» (последнее — только с MSYS_NO_PATHCONV=1). Git Bash на Windows переписывает
// аргумент вида /v2 в C:/Program Files/Git/v2; скрипт в этом случае падает с подсказкой. Запуск с «/v2» возможен
// только с MSYS_NO_PATHCONV=1.
//
// Сервер скрипт не поднимает: dev-сервер должен слушать http://127.0.0.1:3110 (другой адрес — переменная SHOTS_BASE).
// Имя файла: «/» → «root», /v2 → v2, /v2/ui-kit → v2_ui-kit.
// Тема задаётся кукой `theme`; системная тема браузера остаётся светлой, поэтому непринятая кука видна сразу:
// после загрузки проверяется data-theme на <html>. Анимации выключены (reducedMotion), индикатор Next скрыт.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, type BrowserContextOptions } from "@playwright/test";

const BASE = (process.env.SHOTS_BASE ?? "http://127.0.0.1:3110").replace(/\/+$/, "");
/** Витрина — единственная страница, где главных действий может быть много. */
const SHOWCASE = "/v2/ui-kit";
const USAGE = "Запуск: npx tsx scripts/shots.ts v2 v2/ui-kit [--out <папка>]";

type Viewport = "mobile" | "desktop";
type Theme = "light" | "dark";

const VIEWPORTS: Record<Viewport, BrowserContextOptions> = {
  mobile: { ...devices["Pixel 7"] },
  desktop: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
};
const THEMES: readonly Theme[] = ["light", "dark"];

const say = (line: string): void => void process.stdout.write(`${line}\n`);

/** Путь с ведущим «/», без завершающего «/»; корень — «/». Адрес Windows (Git Bash переписал «/v2») — ошибка. */
function normalizeRoute(arg: string): string {
  if (/^[A-Za-z]:[\\/]/.test(arg) || arg.includes("Program Files")) {
    throw new Error(
      `Git Bash переписал путь («${arg}»); запускайте без ведущего "/" (v2/ui-kit) или с MSYS_NO_PATHCONV=1.\n${USAGE}`,
    );
  }
  const clean = arg.replace(/^\/+/, "").replace(/\/+$/, "");
  return `/${clean}`;
}

/** Имя файла по пути: «/» → «root», «/» между сегментами → «_» (/v2/ui-kit → v2_ui-kit). */
function fileStem(route: string): string {
  const clean = route.replace(/^\/+|\/+$/g, "").replace(/[^\w./-]+/g, "_");
  return clean === "" ? "root" : clean.replace(/\//g, "_");
}

function parseArgs(argv: string[]): { routes: string[]; out: string } {
  const routes: string[] = [];
  let out = path.join("test-results", "shots");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error(`--out требует папку.\n${USAGE}`);
      out = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Неизвестный параметр «${arg}».\n${USAGE}`);
    } else {
      routes.push(normalizeRoute(arg));
    }
  }
  if (routes.length === 0) throw new Error(`Нужен хотя бы один путь.\n${USAGE}`);
  return { routes, out };
}

async function ensureServer(): Promise<void> {
  try {
    await fetch(`${BASE}/v2`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`Сервер не отвечает на ${BASE}. Поднимите dev-сервер или задайте адрес в SHOTS_BASE.`);
  }
}

async function main(): Promise<void> {
  const { routes, out } = parseArgs(process.argv.slice(2));
  await ensureServer();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const tooMany: string[] = [];
  try {
    for (const viewport of Object.keys(VIEWPORTS) as Viewport[]) {
      for (const theme of THEMES) {
        // Системная тема остаётся светлой: тёмную должна включить кука, а не браузер.
        const context = await browser.newContext({ ...VIEWPORTS[viewport], reducedMotion: "reduce" });
        await context.addCookies([{ name: "theme", value: theme, url: BASE }]);
        for (const route of routes) {
          const page = await context.newPage();
          const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
          if (!response || response.status() >= 400) {
            throw new Error(`${route} (${viewport}, ${theme}): ответ ${response?.status() ?? "нет"}`);
          }
          await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          await page.evaluate(() => document.fonts.ready);
          const pathname = new URL(page.url()).pathname;
          if (pathname === "/v2" || pathname.startsWith("/v2/")) {
            const applied = await page.evaluate(() => document.documentElement.dataset.theme);
            if (applied !== theme) {
              throw new Error(`${route} (${viewport}): ждали data-theme="${theme}", на странице "${applied ?? "нет"}". Кука темы не принята.`);
            }
          } else {
            say(`Предупреждение: для ${route} тема не применяется (адрес старого интерфейса), проверка темы пропущена.`);
          }
          const primary = await page.locator("[data-primary-action]").count();
          if (primary > 1 && pathname.replace(/\/+$/, "") !== SHOWCASE) {
            tooMany.push(`${route} (${viewport}, ${theme}): ${primary}`);
          }
          const stem = `${fileStem(route)}-${viewport}-${theme}`;
          if (viewport === "mobile") {
            const fold = path.join(out, `${stem}-fold.png`);
            await page.screenshot({ path: fold, fullPage: false });
            say(fold);
          }
          const file = path.join(out, `${stem}.png`);
          await page.screenshot({ path: file, fullPage: true });
          say(file);
          await page.close();
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (tooMany.length > 0) {
    throw new Error(`Больше одного [data-primary-action] на странице:\n${tooMany.join("\n")}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
