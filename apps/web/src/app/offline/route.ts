import { ru } from "@/i18n/ru";
import { BRAND_COLORS } from "@/ui/brand";

const t = ru.pwa.offline;
const c = BRAND_COLORS;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Страница «Нет связи» для сервис-воркера (public/sw.js): он сохраняет её при установке и показывает,
 * когда переход по сайту не удался без сети. Самодостаточный HTML без скриптов и стилей сборки —
 * офлайн их не загрузить. Ничего приватного: ни сессии, ни данных, поэтому без входа и без пароля
 * демо-стенда (demo-gate); входных данных нет — zod-схема и requireUser не нужны.
 */
export function GET() {
  const html = `<!doctype html>
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
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
