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
 * «от N ₸». Кликабельна вся карточка: единственная ссылка — заголовок, растянутая на карточку (`after:absolute
 * after:inset-0`), вложенных интерактивных элементов нет. Кольцо фокуса рисуется по карточке (`has-focus-visible`),
 * отклик на нажатие — у карточки. Имя ссылки для диктора — заголовок. Серверный компонент.
 */
export function WorkCard({ href, title, meta, priceFrom, photo }: WorkCardProps) {
  return (
    <Card
      as="article"
      className="relative flex flex-col gap-3 pressable has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
    >
      <PhotoSlot ratio="4/3" src={photo?.src} alt={photo?.alt ?? ""} />
      <div className="flex flex-col gap-1">
        <h3 className="text-card text-ink">
          <Link href={href} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {title}
          </Link>
        </h3>
        <p className="text-sub text-muted">{meta}</p>
        {priceFrom !== undefined && (
          <p className="text-body text-ink">
            {ru.app.kit.workCard.priceFrom} <Money tiyn={priceFrom} />
          </p>
        )}
      </div>
    </Card>
  );
}
