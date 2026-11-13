import Link from "next/link";
import { ru } from "@/i18n/ru";
import { buttonClasses } from "./button-styles";
import { cn } from "./cn";

export type PaginationProps = {
  /** Текущая страница, с 1. */
  page: number;
  pageCount: number;
  /** Адрес страницы N (через `to()` с параметром `page`). */
  hrefFor: (page: number) => string;
  /** Имя навигации для диктора. */
  label: string;
};

const t = ru.app.kit.pagination;
const step = cn(buttonClasses({ variant: "secondary" }), "flex-1");
const edge = cn(step, "bg-line text-muted");

/**
 * «Назад — Страница N из M — Вперёд». Страниц одна и меньше — ничего не рисуется. На краю нужная кнопка остаётся на
 * месте приглушённой (`aria-disabled`, не ссылка), чтобы строка не прыгала. Серверный компонент.
 */
export function Pagination({ page, pageCount, hrefFor, label }: PaginationProps) {
  if (!(pageCount > 1)) return null;
  const current = Math.min(Math.max(Math.round(page), 1), pageCount);
  return (
    <nav aria-label={label} className="flex items-center gap-3">
      {current > 1 ? (
        <Link href={hrefFor(current - 1)} rel="prev" className={step}>
          {t.prev}
        </Link>
      ) : (
        <span aria-disabled="true" className={edge}>
          {t.prev}
        </span>
      )}
      <p className="shrink-0 text-center text-sub text-muted">{t.pageOf(current, pageCount)}</p>
      {current < pageCount ? (
        <Link href={hrefFor(current + 1)} rel="next" className={step}>
          {t.next}
        </Link>
      ) : (
        <span aria-disabled="true" className={edge}>
          {t.next}
        </span>
      )}
    </nav>
  );
}
