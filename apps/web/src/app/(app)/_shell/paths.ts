/**
 * Префикс адресов v2. Пока v1 жив, v2 живёт под /v2; при переключении (этап 6) префикс станет пустой строкой —
 * меняется только эта константа.
 */
const BASE = "/v2";

/** Адрес экрана v2 по пути без префикса: to("/deals/42") → "/v2/deals/42", to("/") → "/v2". */
export function to(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  if (absolute === "/") return BASE || "/";
  return `${BASE}${absolute}`;
}

/** Адрес того же экрана в v1 (для заглушки «раздел переносится»): legacy("/v2/deals/42") → "/deals/42". */
export function legacy(path: string): string {
  if (!BASE) return path;
  if (path === BASE) return "/";
  return path.startsWith(`${BASE}/`) ? path.slice(BASE.length) : path;
}
