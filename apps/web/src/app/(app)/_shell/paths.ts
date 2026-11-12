/**
 * Префикс адресов v2. Пока v1 жив, v2 живёт под /v2; при переключении (этап 6) префикс станет пустой строкой —
 * меняется только эта константа (оба значения проверяет paths.test.ts).
 */
const BASE = "/v2";

/**
 * Адреса для префикса `base` — пустая строка или путь вида "/v2" (с «/» в начале и без «/» в конце).
 *
 * - `to(path)` — адрес экрана v2 по пути без префикса: to("/deals/42") → "/v2/deals/42", to("/") и to("") → "/v2",
 *   to("/?a=1") → "/v2?a=1". Адрес, уже начинающийся с префикса, возвращается как есть: to("/v2/deals") → "/v2/deals".
 * - `legacy(path)` — адрес того же экрана в v1: legacy("/v2/deals/42") → "/deals/42", legacy("/v2") и legacy("/v2/") → "/",
 *   legacy("/v2?tab=1") → "/?tab=1". Адрес не под префиксом — как есть.
 *
 * При пустом префиксе обе функции возвращают путь как есть (корень — "/", корень с параметрами — "/?a=1").
 */
export function makePaths(base: string): { to: (path: string) => string; legacy: (path: string) => string } {
  /** Адрес уже под префиксом: сам префикс, а за ним — «/», «?» или «#» (`/v2x` — другой путь). */
  const underBase = (path: string): boolean =>
    base !== "" && path.startsWith(base) && (path.length === base.length || "/?#".includes(path[base.length]));

  return {
    to(path) {
      const absolute = path.startsWith("/") ? path : `/${path}`;
      if (underBase(absolute)) return absolute;
      // Корень с параметрами или якорем: «/v2?a=1», а не «/v2/?a=1».
      if (absolute === "/" || absolute[1] === "?" || absolute[1] === "#") return (base || "/") + absolute.slice(1);
      return `${base}${absolute}`;
    },
    legacy(path) {
      if (!underBase(path)) return path;
      const rest = path.slice(base.length);
      if (rest === "") return "/";
      return rest.startsWith("/") ? rest : `/${rest}`;
    },
  };
}

export const { to, legacy } = makePaths(BASE);
