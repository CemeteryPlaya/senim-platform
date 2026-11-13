import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { cn } from "./cn";
import { Money } from "./Money";
import { PhotoSlot } from "./PhotoSlot";

export type WorkCardProps = {
  /** Адрес карточки; без него карточка неинтерактивна (нет ссылки, шеврона, отклика на нажатие и кольца фокуса). */
  href?: string;
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
  /** Уровень заголовка: на странице-списке сразу под `<h1>` карточки — `2` (по умолчанию `3`). */
  headingLevel?: 2 | 3;
};

/**
 * Карточка работы в каталоге и на профиле. Кликабельна (при заданном `href`) вся карточка: единственная ссылка — заголовок, растянутая на
 * карточку (`after:absolute after:inset-0`), вложенных интерактивных элементов нет; кольцо фокуса — по карточке.
 *
 * `media="none"` (по умолчанию): текст без области фото. Заголовок 17 / 600; `meta` и `byline` 15 muted. Телефон
 * (уплотнено: вертикальные поля 12 px, чтобы на экран помещалось больше карточек): `meta · byline` в одной строке
 * (переносится), цена «от N ₸» в той же строке справа, шеврон справа. Компьютер: `meta` и `byline` отдельными
 * строками, цена прижата к низу карточки (`mt-auto`) — карточки ряда одной высоты, цены на одной линии (строка
 * `desktop:contents` растворяется, и цена становится ребёнком колонки). `media="slot"`: над текстом область 4 : 3 с
 * радиусом 12 px — фото или ровная заглушка; шеврона нет, поля 16 px. Серверный компонент.
 */
export function WorkCard({ href, title, meta, byline, priceFrom, media = "none", photo, headingLevel = 3 }: WorkCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const compact = media === "none";
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Heading className="text-card text-ink">
        {href ? (
          <Link href={href} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {title}
          </Link>
        ) : (
          title
        )}
      </Heading>
      <div className="mobile:flex mobile:items-end mobile:gap-3 desktop:contents">
        <p className="min-w-0 flex-1 text-sub text-muted desktop:flex-none">
          <span className="desktop:block">{meta}</span>
          {byline && (
            <>
              <span aria-hidden className="desktop:hidden">
                {" · "}
              </span>
              <span className="desktop:block">{byline}</span>
            </>
          )}
        </p>
        {priceFrom !== undefined && (
          <p className="shrink-0 text-body font-medium text-ink desktop:mt-auto desktop:pt-2">
            {ru.app.kit.workCard.priceFrom} <Money tiyn={priceFrom} />
          </p>
        )}
      </div>
    </div>
  );
  return (
    <Card
      as="article"
      className={cn(
        "relative flex h-full flex-col gap-3",
        href && "pressable has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        compact && "mobile:py-3",
      )}
    >
      {compact ? (
        <div className="flex flex-1 items-stretch gap-3">
          {text}
          {href && <ChevronRight aria-hidden className="size-5 shrink-0 self-center text-muted desktop:hidden" />}
        </div>
      ) : (
        <>
          <PhotoSlot ratio="4/3" src={photo?.src} alt={photo?.alt ?? ""} />
          {text}
        </>
      )}
    </Card>
  );
}
