import Link from "next/link";
import { BadgeCheck, ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { Money, StatusBadge } from "./display";
import { formatDeals } from "./format";

const t = ru.common.ui.workCard;

export type WorkCardProps = {
  /** Куда ведёт карточка (заголовок — растянутая ссылка). Без href карточка не кликабельна. */
  href?: string;
  photoUrl: string | null;
  photoAlt?: string;
  title?: string;
  /** Цена «от», тенге; null — «Цена по запросу». */
  priceFrom: number | null;
  /** 2–3 параметра: тип, срок, город. */
  meta: readonly string[];
  verified?: boolean;
  dealsCount?: number;
  /** Дополнительные метки рядом с «Проверен». */
  children?: ReactNode;
  /** Свои ссылки и кнопки карточки (исполнитель, «Хочу похожее»): лежат поверх растянутой ссылки. */
  footer?: ReactNode;
  className?: string;
};

/** Карточка работы (Kolesa/Krisha): фото, цена «от», параметры, «Проверен», число сделок. */
export function WorkCard({ href, photoUrl, photoAlt = "", title, priceFrom, meta, verified, dealsCount, children, footer, className }: WorkCardProps) {
  const heading = title ? (
    href ? (
      <Link href={href} className="rounded-control text-ink no-underline after:absolute after:inset-0">
        {title}
      </Link>
    ) : (
      title
    )
  ) : null;
  // Без заголовка растянутой ссылкой становится цена.
  const price = (
    <>
      {priceFrom !== null ? (
        <>
          {t.priceFrom} <Money amount={priceFrom} />
        </>
      ) : (
        <span className="text-base font-normal text-muted">{t.priceUnknown}</span>
      )}
    </>
  );
  return (
    <article className={cn("relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface", className)}>
      {photoUrl ? (
        // Демо-фото — SVG из public/, оптимизатор next/image не нужен.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={photoAlt} loading="lazy" className="aspect-[4/3] w-full bg-sunken object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-sunken text-muted">
          <ImageOff aria-hidden className="size-8" />
          <span className="text-sm">{t.noPhoto}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <p className="text-xl font-extrabold text-ink">
          {title || !href ? price : (
            <Link href={href} className="text-ink no-underline after:absolute after:inset-0">
              {price}
            </Link>
          )}
        </p>
        {heading && <h3 className="text-lg font-bold break-words text-ink">{heading}</h3>}
        {meta.length > 0 && <p className="text-base break-words text-ink-soft">{meta.join(" · ")}</p>}
        {(verified || dealsCount !== undefined || children) && (
          <div className="flex flex-wrap gap-2">
            {verified && (
              <StatusBadge tone="success" icon={<BadgeCheck />}>
                {t.verified}
              </StatusBadge>
            )}
            {dealsCount !== undefined && <StatusBadge tone="neutral">{formatDeals(dealsCount)}</StatusBadge>}
            {children}
          </div>
        )}
        {footer && <div className="relative z-10 mt-auto flex flex-col gap-2 border-t border-line pt-3">{footer}</div>}
      </div>
    </article>
  );
}
