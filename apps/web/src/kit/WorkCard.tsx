import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { Money } from "./Money";
import { PhotoSlot } from "./PhotoSlot";

export type WorkCardProps = {
  href: string;
  title: string;
  /** Вторая строка: город, мастер — то, что экран решил показать (без контактов до оферты). */
  meta: string;
  /** Третья строка (например «Мастер № 1042 · 48 сделок»): текст даёт вызывающий. */
  byline?: string;
  /** Цена «от», тиыны. */
  priceFrom?: bigint;
  /** Область изображения: `none` — компактная текстовая карточка (по умолчанию), `slot` — область 4 : 3 над текстом. */
  media?: "none" | "slot";
  /** Фото для `media="slot"`; без него — ровная заглушка. В режиме `none` не показывается. */
  photo?: { src: string; alt: string };
};

/**
 * Карточка работы в каталоге и на профиле. Кликабельна вся карточка: единственная ссылка — заголовок, растянутая на
 * карточку (`after:absolute after:inset-0`), вложенных интерактивных элементов нет; кольцо фокуса — по карточке.
 *
 * `media="none"` (по умолчанию): текст без области фото — заголовок 17 / 600, `meta` и `byline` 15 muted, цена «от N ₸»
 * прижата к низу (карточки ряда одной высоты — цены на одной линии); на телефоне справа шеврон. `media="slot"`: над
 * текстом область 4 : 3 с радиусом 12 px внутри поля карточки — фото или ровная заглушка; шеврона нет. Серверный
 * компонент.
 */
export function WorkCard({ href, title, meta, byline, priceFrom, media = "none", photo }: WorkCardProps) {
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h3 className="text-card text-ink">
        <Link href={href} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
          {title}
        </Link>
      </h3>
      <p className="text-sub text-muted">{meta}</p>
      {byline && <p className="text-sub text-muted">{byline}</p>}
      {priceFrom !== undefined && (
        <p className="mt-auto pt-2 text-body font-medium text-ink">
          {ru.app.kit.workCard.priceFrom} <Money tiyn={priceFrom} />
        </p>
      )}
    </div>
  );
  return (
    <Card
      as="article"
      className="relative flex h-full flex-col gap-3 pressable has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
    >
      {media === "slot" ? (
        <>
          <PhotoSlot ratio="4/3" src={photo?.src} alt={photo?.alt ?? ""} />
          {text}
        </>
      ) : (
        <div className="flex flex-1 items-stretch gap-3">
          {text}
          <ChevronRight aria-hidden className="size-5 shrink-0 self-center text-muted desktop:hidden" />
        </div>
      )}
    </Card>
  );
}
