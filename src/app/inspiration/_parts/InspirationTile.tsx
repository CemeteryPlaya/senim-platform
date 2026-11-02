import Link from "next/link";
import { ImageOff, MapPin } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { InspirationTile as Tile } from "@/modules/companies";
import { StatusBadge } from "@/ui";

const t = ru.companies.inspiration;

/**
 * Плитка ленты: крупное фото, название, тип и стиль, место, подпись исполнителя. Вся плитка — одна ссылка
 * на карточку работы; фото внутри ссылки без alt — его смысл уже в названии (иначе диктор читает его дважды).
 * Кандидат в @/ui (PhotoCard).
 */
export function InspirationTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={`/inspiration/${tile.id}`}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface text-ink no-underline shadow-card hover:border-line-strong"
    >
      <div className="relative">
        {tile.cover?.src ? (
          // Подписанные ссылки хранилища и SVG сида — оптимизатор next/image не нужен.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.cover.src} alt="" loading="lazy" className="aspect-[4/5] w-full bg-sunken object-cover" />
        ) : (
          <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 bg-sunken text-muted">
            <ImageOff aria-hidden className="size-8" />
            <span className="text-sm">{ru.companies.noPhoto}</span>
          </div>
        )}
        {tile.featured && (
          <span className="absolute top-2 left-2 max-w-[calc(100%-1rem)]">
            <StatusBadge tone="accent">{t.featured}</StatusBadge>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-base font-bold break-words">{tile.title}</h3>
        <p className="text-sm break-words text-ink-soft">
          {tile.furnitureType.name}, {tile.style.name.toLowerCase()}
        </p>
        {tile.place && (
          <p className="flex items-start gap-1 text-sm break-words text-muted">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
            {tile.place}
          </p>
        )}
        <p className="text-sm break-words text-muted">{tile.executorLabel}</p>
        {tile.doneOnPlatform && (
          <span className="mt-auto pt-1">
            <StatusBadge tone="success">{t.doneOnPlatform}</StatusBadge>
          </span>
        )}
      </div>
    </Link>
  );
}
