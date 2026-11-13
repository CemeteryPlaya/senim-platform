// Снимки страниц нового интерфейса.
//
//   npx tsx scripts/shots.ts v2 v2/ui-kit v2/catalog [--out <папка>] [--as <телефон> [--role client|executor]]
//
// --as <телефон>: перед съёмкой войти этим номером через /v2/login (код берётся из плашки на экране) и снимать пути вошедшим.
// Номер новый — скрипт сам проходит онбординг (согласие, знакомство с новым ИИН, дальше шаги, которые есть в
// e2e-v2/support.ts passOnboarding); роль по умолчанию — покупатель, `--role executor` — мастер (роль выбирается только на
// первом шаге входа и для уже известного номера ничего не меняет). Номер должен быть новым для identity стенда: берите
// случайный (+7 7XX …), повтор кода раньше минуты стенд отвергает. Состояние входа (cookie) лежит во временной папке ОС на
// время запуска и удаляется в конце; в репозиторий и в папку снимков не попадает. Без --as — как раньше, гостем.
//
// Путей сколько угодно (v2/catalog — заглушка раздела из меню гостя: на ней видно выделение текущего раздела).
// Для каждого пути: компьютер — <имя>-desktop-{light,dark}.png (страница целиком); телефон —
// <имя>-mobile-{light,dark}.png (страница целиком) и <имя>-mobile-{light,dark}-fold.png (только первый экран).
// Файлы — в test-results/shots/ (или в --out).
//
// Пути пишите БЕЗ ведущего «/» (v2, v2/ui-kit). Корень сайта снимается аргументом "" или «/» (последнее — только с MSYS_NO_PATHCONV=1). Git Bash на Windows переписывает
// аргумент вида /v2 в C:/Program Files/Git/v2; скрипт в этом случае падает с подсказкой. Запуск с «/v2» возможен
// только с MSYS_NO_PATHCONV=1.
//
// Сервер скрипт не поднимает: dev-сервер должен слушать http://localhost:3110 (другой адрес — переменная SHOTS_BASE). Именно localhost, не 127.0.0.1:
// dev-сервер Next не отдаёт HMR-сокет чужому источнику, страница не гидратируется и формы входа не работают.
// Имя файла: «/» → «root», /v2 → v2, /v2/ui-kit → v2_ui-kit.
// Тема задаётся кукой `theme`; системная тема браузера остаётся светлой, поэтому непринятая кука видна сразу:
// после загрузки проверяется data-theme на <html>. Анимации выключены (reducedMotion), индикатор Next скрыт.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { loginV2, passOnboarding, type LoginRole } from "../e2e-v2/support";

const BASE = (process.env.SHOTS_BASE ?? "http://localhost:3110").replace(/\/+$/, "");
/** Витрина — единственная страница, где главных действий может быть много. */
const SHOWCASE = "/v2/ui-kit";
const USAGE = "Запуск: npx tsx scripts/shots.ts v2 v2/ui-kit v2/catalog [--out <папка>] [--as <телефон> [--role client|executor]]";
/** Шаги онбординга: если после входа адрес остался на них, пути за входом отправят обратно на шаг. */
const ONBOARDING_PATHS = ["/v2/consent", "/v2/welcome", "/v2/email"];
/**
 * Выше этой высоты (CSS px) окно для полного снимка не растягивается: огромное окно Chromium рисует медленно и может
 * упереться в предел текстуры. Тогда — штатный fullPage с предупреждением (прилипшая панель может застыть посередине).
 */
const MAX_STRETCH = 16_000;

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

type Args = { routes: string[]; out: string; phone: string | null; role: LoginRole };

function parseArgs(argv: string[]): Args {
  const routes: string[] = [];
  let out = path.join("test-results", "shots");
  let phone: string | null = null;
  let role: LoginRole = "client";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" || arg === "--as" || arg === "--role") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} требует значение.\n${USAGE}`);
      if (arg === "--out") out = value;
      else if (arg === "--as") phone = value;
      else if (value === "client" || value === "executor") role = value;
      else throw new Error(`--role: «client» или «executor», получено «${value}».\n${USAGE}`);
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Неизвестный параметр «${arg}».\n${USAGE}`);
    } else {
      routes.push(normalizeRoute(arg));
    }
  }
  if (routes.length === 0) throw new Error(`Нужен хотя бы один путь.\n${USAGE}`);
  return { routes, out, phone, role };
}

async function ensureServer(): Promise<void> {
  try {
    await fetch(`${BASE}/v2`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error(`Сервер не отвечает на ${BASE}. Поднимите dev-сервер или задайте адрес в SHOTS_BASE.`);
  }
}

/** Вход по номеру в отдельном окне компьютера; состояние (cookie сессии) — в файл. Новый номер проходит онбординг. */
async function signIn(browser: Browser, phone: string, role: LoginRole, stateFile: string): Promise<void> {
  const context = await browser.newContext({ ...VIEWPORTS.desktop, reducedMotion: "reduce", baseURL: BASE });
  try {
    const page = await context.newPage();
    await loginV2(page, phone, { role });
    await passOnboarding(page);
    const final = new URL(page.url()).pathname.replace(/\/+$/, "");
    // passOnboarding проходит все шаги (согласие, знакомство, почта); остаться на шаге — сбой входа, а не повод снимать.
    if (ONBOARDING_PATHS.includes(final)) throw new Error(`После входа адрес остался на шаге онбординга (${final}).`);
    say(`Вход выполнен (${phone}, роль ${role}); адрес после входа: ${final || "/"}`);
    await context.storageState({ path: stateFile });
  } finally {
    await context.close();
  }
}

/** Покой страницы перед кадром: гидратация (сеть утихла), шрифты, два кадра отрисовки (прокрутка к выбранному чипу и т. п.). */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {
    say("Предупреждение: сеть не утихла за 20 с, снимок сделан без полного покоя.");
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function main(): Promise<void> {
  const { routes, out, phone, role } = parseArgs(process.argv.slice(2));
  await ensureServer();
  mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const stateDir = phone ? mkdtempSync(path.join(tmpdir(), "senim-shots-")) : null;
  const stateFile = stateDir ? path.join(stateDir, "state.json") : null;
  const tooMany: string[] = [];
  try {
    if (phone && stateFile) await signIn(browser, phone, role, stateFile);
    for (const viewport of Object.keys(VIEWPORTS) as Viewport[]) {
      for (const theme of THEMES) {
        // Системная тема остаётся светлой: тёмную должна включить кука, а не браузер.
        const context = await browser.newContext({
          ...VIEWPORTS[viewport],
          reducedMotion: "reduce",
          ...(stateFile ? { storageState: stateFile } : {}),
        });
        await context.addCookies([{ name: "theme", value: theme, url: BASE }]);
        for (const route of routes) {
          const page = await context.newPage();
          const response = await page.goto(`${BASE}${route}`, { waitUntil: "load" });
          if (!response || response.status() >= 400) {
            throw new Error(`${route} (${viewport}, ${theme}): ответ ${response?.status() ?? "нет"}`);
          }
          await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          await settle(page);
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
          // Снимок целиком: окно вытягивается на высоту документа. Иначе Chromium снимает страницу при прежнем окне, и
          // прилипшая панель вкладок (sticky) застывает посередине снимка поверх содержимого — на телефоне так не бывает.
          const size = page.viewportSize();
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          if (height > MAX_STRETCH) {
            say(`Предупреждение: ${route} (${viewport}, ${theme}) выше ${MAX_STRETCH} px (${height}) — снимок штатным fullPage, прилипшие панели могут стоять посередине.`);
          } else if (size && height > size.height) {
            await page.setViewportSize({ width: size.width, height });
            await settle(page);
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
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  }

  if (tooMany.length > 0) {
    throw new Error(`Больше одного [data-primary-action] на странице:\n${tooMany.join("\n")}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
