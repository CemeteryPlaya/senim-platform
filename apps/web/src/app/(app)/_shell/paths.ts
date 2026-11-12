/**
 * Префикс адресов v2. Пока v1 жив, v2 живёт под /v2; при переключении (этап 6) префикс станет пустой строкой —
 * меняется только эта константа.
 */
const BASE: string = "/v2";

/** Адрес уже под префиксом: сам префикс, а за ним — «/», «?» или «#» (`/v2x` — другой путь). */
function underBase(path: string): boolean {
  return BASE !== "" && path.startsWith(BASE) && (path.length === BASE.length || "/?#".includes(path[BASE.length]));
}

/**
 * Адрес экрана v2 по пути без префикса: to("/deals/42") → "/v2/deals/42", to("/") и to("") → "/v2",
 * to("/?a=1") → "/v2?a=1". Адрес, уже начинающийся с префикса, возвращается как есть: to("/v2/deals") → "/v2/deals".
 */
export function to(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  if (underBase(absolute)) return absolute;
  // Корень с параметрами или якорем: «/v2?a=1», а не «/v2/?a=1».
  if (absolute === "/" || absolute[1] === "?" || absolute[1] === "#") return (BASE || "/") + absolute.slice(1);
  return `${BASE}${absolute}`;
}

/**
 * Адрес того же экрана в v1 (для заглушки «раздел переносится»): legacy("/v2/deals/42") → "/deals/42",
 * legacy("/v2") и legacy("/v2/") → "/", legacy("/v2?tab=1") → "/?tab=1". Адрес не под префиксом — как есть.
 */
export function legacy(path: string): string {
  if (!underBase(path)) return path;
  const rest = path.slice(BASE.length);
  if (rest === "") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
