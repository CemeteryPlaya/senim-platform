/** Что нужно знать о нажатии, чтобы решить, уводит ли оно с этой страницы (чистая часть `LeaveGuard`). */
export type ClickInfo = {
  button: number;
  modifiers: boolean;
  defaultPrevented: boolean;
  /** Ближайшая ссылка под нажатием: адрес, окно и признак скачивания; `null` — нажали не на ссылку. */
  link: { href: string; target: string; download: boolean } | null;
  /** Где человек сейчас. */
  here: { origin: string; pathname: string; search: string };
};

/**
 * Куда уводит нажатие по ссылке (путь со строкой запроса), если это переход по этому сайту на другую страницу без
 * новой вкладки; иначе `null` — не мешаем (внешние ссылки, новая вкладка, скачивание, якорь на этой же странице).
 */
export function leavingPath(click: ClickInfo): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.modifiers || click.link === null) return null;
  if (click.link.download || (click.link.target !== "" && click.link.target !== "_self")) return null;
  let url: URL;
  try {
    url = new URL(click.link.href, click.here.origin);
  } catch {
    return null;
  }
  if (url.origin !== click.here.origin) return null;
  if (url.pathname === click.here.pathname && url.search === click.here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
