import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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

// ---------------------------------------------------------------------------------------------------------------------
// Компонентные тесты в jsdom (файлы с `// @vitest-environment jsdom`): отрисовка в документ и ввод так, как его видит
// React — запись значения мимо отслеживания React и событие `input` с `inputType` и `data`.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Помощники компонентных тестов в jsdom (файлы с `// @vitest-environment jsdom`): отрисовка в документ и ввод так, как
 * его видит React — запись значения мимо отслеживания React и событие `input` с `inputType` и `data`.
 */

/** Окружение jsdom для React: флаг act() и заглушки того, чего в jsdom нет (прокрутка к элементу, запросы к медиа). */
function prepareDom(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  window.matchMedia ??= (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}

export type Mounted = { container: HTMLDivElement; root: Root; unmount: () => void };

export function mount(element: ReactElement): Mounted {
  prepareDom();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Поле получает строку `raw` с курсором `caret`, как после правки браузера, и событие `input`. */
export function edit(input: HTMLInputElement, raw: string, options: { caret?: number; inputType?: string; data?: string | null } = {}): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, raw);
    const caret = options.caret ?? raw.length;
    // У type=email выделения нет (setSelectionRange бросает исключение) — курсор там не задаётся.
    if (input.selectionStart !== null) input.setSelectionRange(caret, caret);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: options.inputType ?? "insertText", data: options.data ?? null }));
  });
}

/** Вставка из буфера: событие `paste` с `clipboardData`, как у браузера (в jsdom ClipboardEvent нет). */
export function paste(input: HTMLInputElement, text: string): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  let notPrevented = true;
  act(() => {
    notPrevented = input.dispatchEvent(event);
  });
  return notPrevented;
}

/** Отправка формы так, как её делает кнопка или CodeField (`requestSubmit`), внутри act. */
export function submit(form: HTMLFormElement): void {
  act(() => form.requestSubmit());
}
