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
/** Край: не ссылка, а приглушённый текст на подложке line (отдельная строка классов — без конфликта с `text-ink`). */
const edge = "inline-flex min-h-control min-w-0 flex-1 items-center justify-center rounded-control bg-line px-6 text-center text-body font-semibold text-muted";

/**
 * «Назад — Страница N из M — Вперёд». Страниц одна и меньше, а также нечисловые или нецелые значения (NaN, Infinity) — ничего не рисуется; дробные округляются вниз, номер страницы ограничивается 1…M. На краю нужная кнопка остаётся на
 * месте приглушённым текстом (не ссылка), чтобы строка не прыгала. Серверный компонент.
 */
export function Pagination({ page, pageCount, hrefFor, label }: PaginationProps) {
  if (!Number.isFinite(page) || !Number.isFinite(pageCount)) return null;
  const count = Math.trunc(pageCount);
  if (count <= 1) return null;
  const current = Math.min(Math.max(Math.trunc(page), 1), count);
  return (
    <nav aria-label={label} className="flex items-center gap-3">
      {current > 1 ? (
        <Link href={hrefFor(current - 1)} rel="prev" className={step}>
          {t.prev}
        </Link>
      ) : (
        <span className={edge}>
          {t.prev}
        </span>
      )}
      <p className="shrink-0 text-center text-sub text-muted">{t.pageOf(current, count)}</p>
      {current < count ? (
        <Link href={hrefFor(current + 1)} rel="next" className={step}>
          {t.next}
        </Link>
      ) : (
        <span className={edge}>
          {t.next}
        </span>
      )}
    </nav>
  );
}
