import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { StatusBadge } from "./display";

const t = ru.common.ui.requestCard;

export type RequestCardProps = {
  href: string;
  thumbUrl: string | null;
  title: string;
  /** Район, бюджет, время. */
  meta: readonly string[];
  isNew: boolean;
  /** Число откликов; не задано — строки нет (например, в «Моих откликах»). */
  offersCount?: number;
  /** Метки рядом с «Новая»: статус, «Прямой запрос». */
  badges?: ReactNode;
  className?: string;
};

/**
 * Карточка заявки (Krisha): миниатюра, «Новая», название, параметры, число откликов. Вся карточка — одна ссылка.
 * Название — первым в разметке (имя ссылки начинается с него), метки показаны над ним через order-first.
 */
export function RequestCard({ href, thumbUrl, title, meta, isNew, offersCount, badges, className }: RequestCardProps) {
  return (
    <Link
      href={href}
      className={cn("flex min-w-0 flex-wrap gap-3 rounded-card border border-line bg-surface p-3 text-ink no-underline hover:border-line-strong", className)}
    >
      {thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt="" loading="lazy" className="size-20 shrink-0 rounded-control bg-sunken object-cover" />
      ) : (
        <span className="flex size-20 shrink-0 flex-col items-center justify-center rounded-control bg-sunken text-muted">
          <ImageOff aria-hidden className="size-6" />
          <span className="sr-only">{t.noPhoto}</span>
        </span>
      )}
      <span className="flex min-w-[min(12rem,100%)] flex-1 flex-col gap-1">
        <span className="text-lg font-bold break-words">{title}</span>
        {(isNew || badges) && (
          <span className="order-first flex flex-wrap gap-2">
            {isNew && <StatusBadge tone="warning">{t.isNew}</StatusBadge>}
            {badges}
          </span>
        )}
        {meta.length > 0 && <span className="text-base break-words text-ink-soft">{meta.join(" · ")}</span>}
        {offersCount !== undefined && <span className="text-base font-semibold text-ink-soft">{t.offers(offersCount)}</span>}
      </span>
    </Link>
  );
}
