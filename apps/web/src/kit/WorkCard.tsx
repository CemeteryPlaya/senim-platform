import Link from "next/link";
import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { Money } from "./Money";
import { PhotoSlot } from "./PhotoSlot";

export type WorkCardProps = {
  href: string;
  title: string;
  /** Вторая строка: город, мастер — то, что экран решил показать (без контактов до оферты). */
  meta: string;
  /** Цена «от», тиыны. */
  priceFrom?: bigint;
  photo?: { src: string; alt: string };
};

/**
 * Карточка работы в каталоге и на профиле: фото 4 : 3 (без снимка — ровная заглушка), заголовок, строка `meta`, цена
 * «от N ₸». Вся карточка — одна ссылка. Серверный компонент.
 */
export function WorkCard({ href, title, meta, priceFrom, photo }: WorkCardProps) {
  return (
    <Card as="article">
      <Link href={href} className="flex flex-col gap-3 text-ink no-underline pressable">
        <PhotoSlot ratio="4/3" src={photo?.src} alt={photo?.alt ?? ""} />
        <div className="flex flex-col gap-1">
          <h3 className="text-card">{title}</h3>
          <p className="text-sub text-muted">{meta}</p>
          {priceFrom !== undefined && (
            <p className="text-body text-ink">
              {ru.app.kit.workCard.priceFrom} <Money tiyn={priceFrom} />
            </p>
          )}
        </div>
      </Link>
    </Card>
  );
}
