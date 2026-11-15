import Link from "next/link";
import { ru } from "@/i18n/ru";
import { Card, Money, PhotoSlot, StatusChip } from "@/kit";
import type { WorkRow } from "./work-view";

/**
 * Карточка своей работы: фото 4 : 3 во всю ширину карточки сверху (или ровная заглушка), под ним название-ссылка на правку
 * (растянута на карточку), статус чипом, вторая строка — тип, стиль и число фото, цена «от» отдельной строкой. Сетка —
 * две колонки на телефоне и три на компьютере (`page.tsx`), поэтому фото просим для половины экрана. Вложенных
 * интерактивных элементов нет.
 */
export function WorkTile({ row, media }: { row: WorkRow; media: "none" | "slot" }) {
  return (
    <Card as="article" padded={false} className="pressable relative flex h-full flex-col overflow-hidden has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus">
      {media === "slot" && <PhotoSlot ratio="4/3" radius="none" alt={row.photo?.alt ?? ""} {...(row.photo ? { src: row.photo.src } : {})} />}
      <div className="flex min-w-0 flex-col items-start gap-2 p-3 desktop:p-4">
        <StatusChip tone={row.published ? "accent" : "neutral"}>{row.status}</StatusChip>
        <h2 className="text-headline text-ink">
          <Link href={row.href} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {row.title}
          </Link>
        </h2>
        <p className="text-sub text-muted">{row.details}</p>
        {row.priceFrom !== undefined && (
          <p className="text-body font-medium text-ink">
            {ru.app.kit.workCard.priceFrom} <Money tiyn={row.priceFrom} />
          </p>
        )}
      </div>
    </Card>
  );
}
