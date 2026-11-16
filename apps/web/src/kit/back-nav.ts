/**
 * «Назад» как шаг назад по истории (BackLink): чистая логика без React.
 * Оболочка (NavHistory) запоминает адреса вместе со строкой запроса: `prev` — предыдущий адрес этого сайта, `cur` — текущий.
 * «‹ Родитель» возвращает по истории (`history.back()`: прокрутка и фильтры списка на месте) только когда это точно шаг к
 * родителю: ссылка без строки запроса (родитель — список; ссылки с параметрами, например шаг анкеты, остаются ссылками),
 * предыдущий адрес — путь родителя, а запись `cur` совпадает с адресом в окне (память не устарела: вкладку открыли заново,
 * скопировали). Смена одних параметров (сделка → `?history=all`) делает предыдущим адрес самой сделки, поэтому «‹ Сделки» после
 * неё — обычный переход к родителю, а не шаг назад на карточку без параметров. Прямой вход (уведомление, ссылка) — тоже ссылка.
 */

export const NAV_KEY = "senim-nav";

export type NavMemory = { prev: string | null; cur: string | null };

/** Путь без строки запроса, якоря и конечного «/». */
export function pathnameOf(href: string): string {
  const end = href.search(/[?#]/);
  const path = end < 0 ? href : href.slice(0, end);
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/** Адрес сменился (путь или параметры): прежний текущий становится предыдущим. Тот же адрес память не двигает. */
export function visit(memory: NavMemory, address: string): NavMemory {
  if (memory.cur === address) return memory;
  return { prev: memory.cur, cur: address };
}

export type BackClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** Обычное нажатие левой кнопкой: средняя кнопка, Ctrl/⌘ и Shift (новая вкладка или окно) — оставляем ссылке. */
export const isPlainClick = (e: BackClick): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

/** Адрес без якоря: путь и строка запроса. */
const withoutHash = (href: string): string => {
  const at = href.indexOf("#");
  return at < 0 ? href : href.slice(0, at);
};

/**
 * Идти ли по истории назад: обычное нажатие, в истории есть куда возвращаться, ссылка ведёт на родителя без параметров, пришли
 * именно с него (путь `prev`), а память не устарела (`cur` — адрес, который сейчас в окне).
 */
export function shouldGoBack(input: { memory: NavMemory; href: string; current: string; click: BackClick; historyLength: number }): boolean {
  const { memory, href, current, click, historyLength } = input;
  if (!isPlainClick(click) || historyLength <= 1 || memory.prev === null || memory.cur === null) return false;
  if (withoutHash(href).includes("?")) return false;
  if (withoutHash(memory.cur) !== withoutHash(current)) return false;
  return pathnameOf(memory.prev) === pathnameOf(href);
}

/** Чтение памяти из sessionStorage (может быть закрыт или повреждён: тогда «Назад» — обычная ссылка). */
export function readMemory(storage: Pick<Storage, "getItem"> | null): NavMemory {
  try {
    const raw = storage?.getItem(NAV_KEY);
    if (!raw) return { prev: null, cur: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const { prev, cur } = parsed as Record<string, unknown>;
      return { prev: typeof prev === "string" ? prev : null, cur: typeof cur === "string" ? cur : null };
    }
  } catch {
    // Повреждённая запись или недоступное хранилище — как будто памяти нет.
  }
  return { prev: null, cur: null };
}

export function writeMemory(storage: Pick<Storage, "setItem"> | null, memory: NavMemory): void {
  try {
    storage?.setItem(NAV_KEY, JSON.stringify(memory));
  } catch {
    // Хранилище закрыто — не страшно.
  }
}

const session = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/** Память этой вкладки. */
export const navMemory = { read: (): NavMemory => readMemory(session()), write: (memory: NavMemory): void => writeMemory(session(), memory) };
