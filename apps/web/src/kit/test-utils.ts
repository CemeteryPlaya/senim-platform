import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Общие помощники тестов разметки (статический рендер). */

export const html = (el: ReactElement): string => renderToStaticMarkup(el);

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };

/** Видимый текст: без тегов, сущности раскрыты. */
export const text = (el: ReactElement): string =>
  html(el)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#x27);/g, (m) => ENTITIES[m] ?? m);

/** Сколько раз подстрока встречается в разметке. */
export const count = (out: string, needle: string): number => out.split(needle).length - 1;

/** Класс как целое слово (в том числе первый в атрибуте): `w-full` не совпадает с `max-w-full`. */
export const hasClass = (out: string, cls: string): boolean =>
  new RegExp(`class="(?:[^"]*\\s)?${cls.replace(/[-/.:[\]]/g, "\\$&")}(?=\\s|")`).test(out);
