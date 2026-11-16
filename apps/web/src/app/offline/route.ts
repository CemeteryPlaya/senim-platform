import { ru } from "@/i18n/ru";
import { TOKENS } from "@/kit/tokens";
import { BRAND_COLORS } from "@/ui/brand";

const t = ru.pwa.offline;
const c = BRAND_COLORS;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Прежний вид (v1, заморожен): зелёная кнопка, только светлая тема. */
function legacyPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${c.primary}">
<title>${escapeHtml(t.title)} — ${escapeHtml(ru.common.brand)}</title>
<style>
  body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: ${c.canvas}; color: ${c.ink};
    font: 18px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 32rem; margin: 1rem; padding: 1.5rem; background: ${c.surface}; border: 1px solid ${c.line}; border-radius: 1rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.5rem; line-height: 1.25; }
  p { margin: 0 0 1.5rem; color: ${c.muted}; }
  button { min-height: 3.5rem; width: 100%; padding: 0.5rem 1.5rem; border: 2px solid ${c.primary}; border-radius: 1.75rem;
    background: ${c.primary}; color: ${c.onPrimary}; font: inherit; font-weight: 700; cursor: pointer; }
  button:focus-visible { outline: 3px solid ${c.ink}; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(t.title)}</h1>
  <p>${escapeHtml(t.text)}</p>
  <button type="button" onclick="location.reload()">${escapeHtml(t.retry)}</button>
</main>
</body>
</html>`;
}

/** Переменные цвета одной темы из TOKENS — те же роли, что у приложения. */
const themeVars = (theme: "light" | "dark") => {
  const k = TOKENS[theme];
  return `--canvas: ${k.canvas}; --surface: ${k.surface}; --ink: ${k.ink}; --muted: ${k.muted}; --action: ${k.action}; --on-action: ${k["on-action"]}; --focus: ${k.focus};`;
};

/**
 * Вид нового интерфейса (v2, аудит поведения B-6): тёплый фон и карточка, графитовая главная кнопка (радиус 16 px, 52 px,
 * вес 600), заголовок 22 px / 600, текст 17 px; светлая и тёмная тема по настройке системы (кука темы офлайн не читается —
 * страница общая и лежит в кэше без cookies). Шрифт — системный: веб-шрифт без сети не загрузить.
 */
function v2Page(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${TOKENS.light.canvas}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${TOKENS.dark.canvas}">
<title>${escapeHtml(t.title)} — ${escapeHtml(ru.common.brand)}</title>
<style>
  :root { ${themeVars("light")} color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { ${themeVars("dark")} } }
  body { margin: 0; min-height: 100dvh; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
    background: var(--canvas); color: var(--ink); -webkit-font-smoothing: antialiased;
    font: 400 17px/1.47 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, system-ui, sans-serif; }
  main { width: 100%; max-width: 35rem; box-sizing: border-box; padding: 24px; background: var(--surface); border-radius: 20px; }
  h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.27; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0 0 24px; color: var(--muted); }
  button { display: block; width: 100%; min-height: 52px; padding: 0 24px; border: 0; border-radius: 16px;
    background: var(--action); color: var(--on-action); font: inherit; font-weight: 600; cursor: pointer;
    -webkit-tap-highlight-color: transparent; user-select: none; }
  button:active { transform: scale(0.97); }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { button:active { transform: none; } }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(t.title)}</h1>
  <p>${escapeHtml(t.text)}</p>
  <button type="button" onclick="location.reload()">${escapeHtml(t.retry)}</button>
</main>
</body>
</html>`;
}

/**
 * Страница «Нет связи» для сервис-воркера (public/sw.js): он сохраняет обе версии при установке и показывает нужную, когда
 * переход по сайту не удался без сети — для адресов /v2 вид нового интерфейса (`?v=2`), для остальных — прежний (v1
 * заморожен). Самодостаточный HTML без скриптов и стилей сборки — офлайн их не загрузить. Ничего приватного: ни сессии, ни
 * данных, поэтому без входа и без пароля стенда (stand-gate); единственный вход — признак вида в адресе, иначе прежний
 * вид (zod-схема и requireUser не нужны).
 */
export function GET(request?: Request) {
  const v2 = request !== undefined && new URL(request.url).searchParams.get("v") === "2";
  const html = v2 ? v2Page() : legacyPage();
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
