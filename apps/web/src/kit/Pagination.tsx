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

/**
 * Кнопка шага: тихая 36 px на компьютере; на телефоне — серая на всю оставшуюся ширину, 48 px. `buttonClasses` (quiet, sm)
 * даёт 48 px на телефоне и 36 px на компьютере сам.
 */
const step = cn(buttonClasses({ variant: "quiet", size: "sm" }), "flex-1 mobile:bg-fill desktop:flex-none");

/**
 * «Назад — Страница N из M — Вперёд». Компьютер: компактная группа по центру. Телефон: кнопки 48 px делят строку. Края,
 * где идти некуда, не показываются вовсе. Страниц одна и меньше, а также нечисловые значения (NaN, Infinity) — ничего не
 * рисуется; дробные округляются вниз, номер страницы ограничивается 1…M. Серверный компонент.
 */
export function Pagination({ page, pageCount, hrefFor, label }: PaginationProps) {
  if (!Number.isFinite(page) || !Number.isFinite(pageCount)) return null;
  const count = Math.trunc(pageCount);
  if (count <= 1) return null;
  const current = Math.min(Math.max(Math.trunc(page), 1), count);
  return (
    <nav aria-label={label} className="flex items-center gap-3 desktop:justify-center">
      {current > 1 && (
        <Link href={hrefFor(current - 1)} rel="prev" className={step}>
          {t.prev}
        </Link>
      )}
      <p className="shrink-0 text-center text-sub text-muted">{t.pageOf(current, count)}</p>
      {current < count && (
        <Link href={hrefFor(current + 1)} rel="next" className={step}>
          {t.next}
        </Link>
      )}
    </nav>
  );
}
