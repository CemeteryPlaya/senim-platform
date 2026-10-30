import { ru } from "@/i18n/ru";

export const MAIN_ID = "content";

/** Первая ссылка на странице: с клавиатуры — сразу к содержанию, минуя меню. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only rounded-control bg-primary px-4 py-3 text-base font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    >
      {ru.common.shell.skipLink}
    </a>
  );
}
