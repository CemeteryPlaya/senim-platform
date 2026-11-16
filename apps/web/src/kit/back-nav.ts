/**
 * «Назад» как шаг назад по истории (BackLink): чистая логика без React.
 * Оболочка (NavHistory) запоминает, с какого экрана пришли: `prev` — путь предыдущего экрана этого сайта, `cur` — текущего.
 * «‹ Родитель» возвращает по истории (`history.back()`: прокрутка и фильтры списка на месте), если пришли именно с родителя;
 * при прямом входе (уведомление, ссылка, новая вкладка) `prev` пуст или другой — обычный переход к родителю.
 */

export const NAV_KEY = "senim-nav";

export type NavMemory = { prev: string | null; cur: string | null };

/** Путь без строки запроса, якоря и конечного «/». */
export function pathnameOf(href: string): string {
  const end = href.search(/[?#]/);
  const path = end < 0 ? href : href.slice(0, end);
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/** Экран сменился: прежний текущий становится предыдущим. Тот же путь (смена фильтра в адресе) память не двигает. */
export function visit(memory: NavMemory, pathname: string): NavMemory {
  if (memory.cur === pathname) return memory;
  return { prev: memory.cur, cur: pathname };
}

export type BackClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** Обычное нажатие левой кнопкой: средняя кнопка, Ctrl/⌘ и Shift (новая вкладка или окно) — оставляем ссылке. */
export const isPlainClick = (e: BackClick): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

/** Идти ли по истории назад: обычное нажатие, пришли с экрана-родителя, в истории есть куда возвращаться. */
export function shouldGoBack(input: { memory: NavMemory; href: string; click: BackClick; historyLength: number }): boolean {
  const { memory, href, click, historyLength } = input;
  return isPlainClick(click) && historyLength > 1 && memory.prev !== null && pathnameOf(memory.prev) === pathnameOf(href);
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
