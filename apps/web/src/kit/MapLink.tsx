import { ExternalLink } from "lucide-react";
import { ru } from "@/i18n/ru";
import { googleMapsHref, yandexMapsHref, type MapPoint } from "./external-links";

export type MapLinkProps = {
  /** Точка заказа; без неё — только поиск по адресу. */
  point?: MapPoint | null;
  /** Адрес текстом (для поиска, если точки нет). */
  address?: string | null;
};

const LINK = "inline-flex min-h-control items-center gap-1 text-body font-medium text-ink no-underline hover:underline";

/**
 * «Открыть на карте»: ссылки на Яндекс Карты и Google Карты (форматы — `external-links.ts`, по документации), каждая в
 * новой вкладке или приложении. На экране — название карты со значком ↗ (одной строкой), «Открыть на карте:» — для диктора.
 * Без точки и адреса ничего не рисует. Координаты на экране не показываются. Показывать только там, где модуль уже отдал
 * адрес или точку (после оферты). Серверный компонент.
 */
export function MapLink({ point = null, address = null }: MapLinkProps) {
  const t = ru.app.kit.map;
  const all: { name: string; href: string | null }[] = [
    { name: t.yandex, href: yandexMapsHref(point) },
    { name: t.google, href: googleMapsHref(point, address) },
  ];
  const links = all.flatMap((item) => (item.href === null ? [] : [{ name: item.name, href: item.href }]));
  if (links.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-4">
      {links.map((item) => (
        <a key={item.name} href={item.href} target="_blank" rel="noopener noreferrer" className={LINK}>
          <span className="sr-only">{`${t.open}: `}</span>
          {item.name}
          <span className="sr-only"> ({ru.app.kit.externalHint})</span>
          <ExternalLink aria-hidden className="size-4 shrink-0 text-muted" />
        </a>
      ))}
    </span>
  );
}
