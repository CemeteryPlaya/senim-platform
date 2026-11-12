import { ru } from "@/i18n/ru";

/** id области содержимого: на неё ведёт «Перейти к содержимому». */
export const MAIN_ID = "content";

/** Первая ссылка страницы: видна только в фокусе с клавиатуры и ведёт сразу к содержимому, минуя меню. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only rounded-control bg-action px-4 py-3 text-body font-semibold text-on-action no-underline focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {ru.app.shell.skipLink}
    </a>
  );
}

/** Плашка «сервис временно недоступен» (identity не ответил — страница рисуется гостем), как в v1. */
export function UnavailableNotice() {
  return (
    <p role="status" className="mb-6 rounded-card bg-warn-soft p-4 text-body text-warn">
      {ru.common.errors.unavailable}
    </p>
  );
}
