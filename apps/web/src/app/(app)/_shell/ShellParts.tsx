import { ru } from "@/i18n/ru";
import { Notice } from "@/kit";

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

/**
 * Плашка «сервис временно недоступен» (identity не ответил — страница рисуется гостем), как в v1: `Notice` тона warn.
 * live: плашка приходит в разметке сервера, а живую область role="status" диктор читает только при изменении, не при
 * загрузке; role="alert" читается сразу.
 */
export function UnavailableNotice() {
  return (
    <div className="mb-6">
      <Notice tone="warn" live>
        {ru.common.errors.unavailable}
      </Notice>
    </div>
  );
}
