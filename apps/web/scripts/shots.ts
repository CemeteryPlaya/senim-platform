// Снимки страниц нового интерфейса: npx tsx scripts/shots.ts <путь> [<путь>…] [--out <папка>]
// Для каждого пути — четыре файла <имя>-{mobile,desktop}-{light,dark}.png (по умолчанию в test-results/shots/).
// Сервер скрипт не поднимает: dev-сервер должен уже слушать порт 3110.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, type BrowserContextOptions } from "@playwright/test";

const BASE = "http://localhost:3110";
/** Витрина — единственная страница, где главных действий может быть много. */
const SHOWCASE = "/v2/ui-kit";

type Viewport = "mobile" | "desktop";
type Theme = "light" | "dark";

const VIEWPORTS: Record<Viewport, BrowserContextOptions> = {
  mobile: { ...devices["Pixel 7"] },
  desktop: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
};
const THEMES: readonly Theme[] = ["light", "dark"];

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

/** Имя файла по пути: «/» → «_», корень (`/`) — `v2`, если пути нет, берётся `v2`. */
function fileStem(route: string): string {
  const clean = route.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "_");
  return clean === "" ? "v2" : clean.replace(/\//g, "_");
}

function parseArgs(argv: string[]): { routes: string[]; out: string } {
  const routes: string[] = [];
  let out = path.join("test-results", "shots");
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) return fail("--out требует папку");
      out = value;
      i += 1;
    } else if (arg.startsWith("/")) {
      routes.push(arg);
    } else {
      return fail(`Не понимаю аргумент «${arg}». Пути начинаются с «/»: npx tsx scripts/shots.ts /v2 /v2/ui-kit`);
    }
  }
  if (routes.length === 0) return fail("Нужен хотя бы один путь: npx tsx scripts/shots.ts /v2 /v2/ui-kit [--out <папка>]");
  return { routes, out };
}

async function ensureServer(): Promise<void> {
  try {
    await fetch(`${BASE}/v2`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    fail(`Сервер не отвечает на ${BASE}. Подними dev-сервер на порту 3110 (см. constraints) и повтори.`);
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
        const context = await browser.newContext({ ...VIEWPORTS[viewport], colorScheme: theme });
        await context.addCookies([{ name: "theme", value: theme, domain: "localhost", path: "/" }]);
        for (const route of routes) {
          const page = await context.newPage();
          const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
          if (!response || response.status() >= 400) {
            fail(`${route} (${viewport}, ${theme}): ответ ${response?.status() ?? "нет"}`);
          }
          await page.evaluate(() => document.fonts.ready);
          const primary = await page.locator("[data-primary-action]").count();
          if (primary > 1 && route !== SHOWCASE) tooMany.push(`${route} (${viewport}, ${theme}): ${primary}`);
          const file = path.join(out, `${fileStem(route)}-${viewport}-${theme}.png`);
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
    fail(`Больше одного [data-primary-action] на странице:\n${tooMany.join("\n")}`);
  }
}

void main();
