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

/**
 * Адреса экранов обязательных шагов после входа (согласие, знакомство, почта и второй шаг входа оператора — код из
 * приложения): с них `next` не вкладывается сам в себя — возврат после шага берётся из их собственного `next`.
 */
export const ONBOARDING_SCREENS: readonly string[] = ["/consent", "/welcome", "/email", "/operator/mfa"].map((screen) => to(screen));

/**
 * Последняя страховка ссылки, собранной из чужого ввода (адрес запроса): только путь этого сайта, иначе "/".
 * Браузер читает `//host` и `/\host` как ссылку на другой сайт, а перед разбором срезает пробелы и управляющие
 * символы по краям и выбрасывает табуляции и переводы строк внутри (`/\t/host` → `//host`). Поэтому путь должен
 * начинаться ровно с одного «/», за которым не идут «/», «\» и пробел, и не содержать управляющих символов вовсе.
 * Та же проверка, что `safePath` в public/sw.js, только строже.
 */
export function safeLocalPath(path: string): string {
  // Управляющие символы C0 и DEL: браузер выбросил бы их и склеил соседние слеши.
  const control = /[\u0000-\u001f\u007f]/;
  return path.startsWith("/") && !/^\/[/\\\s]/.test(path) && !control.test(path) ? path : "/";
}

/** Адрес разобран на путь, строку запроса (с «?») и якорь (с «#»): любая часть может быть пустой. */
function splitHref(href: string): { path: string; query: string; hash: string } {
  const hashAt = href.indexOf("#");
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const rest = hashAt < 0 ? href : href.slice(0, hashAt);
  const queryAt = rest.indexOf("?");
  return queryAt < 0 ? { path: rest, query: "", hash } : { path: rest.slice(0, queryAt), query: rest.slice(queryAt), hash };
}

/** Сегменты пути, которыми можно выйти из префикса v2 (`/v2/../x`), и обратная косая черта (браузер читает её как «/»). */
const ESCAPING_PATH = /(^|\/)(\.|%2e){1,2}(\/|$)|[\\]/i;

/**
 * `v2Href` для префикса `base` ("" или "/v2"): путь v1, пришедший из модуля (ссылка уведомления, `listChats().href`,
 * `homePathFor`, `switchRoleHref`, ссылка «Поделиться»), — в адрес v2. Чистая функция.
 *
 * - Путь v1 переходит под префикс как есть, вместе со строкой запроса и якорем: `/deals/7/money` → `/v2/deals/7/money`,
 *   `/requests?tab=2` → `/v2/requests?tab=2`, `/` → `/v2`. Путь, которого в v2 ещё нет, тоже: он попадёт в заглушку «Раздел
 *   переносится». Конечный «/» отбрасывается.
 * - Диалог: `/requests/<id>/offers/<offerId>#chat` → `/chats/<offerId>` (строка запроса сохраняется, якорь уходит).
 *   Якорь `#chat` у сделки остаётся на сделке: `/deals/<id>#chat` → `/v2/deals/<id>#chat` — id отклика из пути сделки не
 *   узнать, ссылку на диалог даёт сам экран сделки.
 * - Диалог мастера по заявке: `/executor/requests/<id>#chat` → `/executor/requests/<id>/chat` — id своего предложения из
 *   пути заявки не узнать; этот адрес находит его (модуль requests) и ведёт в диалог `/chats/<offerId>`.
 * - Остальные пути мастера v1 (`/executor/requests…`, `/executor/offers`, `/executor/finance`, `/executor/profile…`,
 *   `/executor/portfolio…`, `/register/executor`) в v2 лежат под теми же путями — переходят под префикс как есть.
 * - Адрес уже под префиксом — как есть.
 * - Всё, что не путь этого сайта, — главная: чужой сайт (`//host`, `/\host`, `https://…`), управляющие символы,
 *   `..` и `\` в пути. Абсолютный адрес принимается, только если указан `origin` сайта и адрес ему принадлежит
 *   (`APP_URL/d/<token>`): тогда берётся его путь.
 */
export function makeV2Href(base: string): (v1Path: string, origin?: string) => string {
  const { to } = makePaths(base);
  return (v1Path, origin) => {
    let local = v1Path;
    if (origin !== undefined && /^https?:\/\//i.test(v1Path)) {
      try {
        const url = new URL(v1Path);
        local = url.origin === new URL(origin).origin ? `${url.pathname}${url.search}${url.hash}` : "";
      } catch {
        local = "";
      }
    }
    if (safeLocalPath(local) !== local) return to("/");
    const { path, query, hash } = splitHref(local);
    if (ESCAPING_PATH.test(path)) return to("/");
    const clean = path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
    const offerChat = hash === "#chat" ? /^\/requests\/[^/]+\/offers\/([^/]+)$/.exec(clean) : null;
    if (offerChat) return to(`/chats/${offerChat[1]}${query}`);
    const requestChat = hash === "#chat" ? /^\/executor\/requests\/[^/]+$/.exec(clean) : null;
    if (requestChat) return to(`${clean}/chat${query}`);
    return to(`${clean}${query}${hash}`);
  };
}

export const v2Href = makeV2Href(BASE);
