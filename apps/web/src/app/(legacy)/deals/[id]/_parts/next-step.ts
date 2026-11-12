/** Заголовок «Что дальше»: после действия сделки фокус возвращается сюда — к новой подсказке и новому действию. */
export const NEXT_HEADING_ID = "next-step";

/** Кнопка действия после обновления экрана исчезает — без этого фокус падает в начало страницы. */
export function focusNextStep(): void {
  document.getElementById(NEXT_HEADING_ID)?.focus();
}
