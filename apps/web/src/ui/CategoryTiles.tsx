import Link from "next/link";
import { LayoutGrid, type LucideIcon } from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type CategoryTileItem = { href: string; label: string; icon: LucideIcon };

const tile =
  "flex min-h-[4.5rem] min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-2 py-3 text-center text-base font-semibold break-words hyphens-auto text-ink no-underline transition-colors duration-150 hover:border-line-strong";

/** Плитки категорий главной (макет b-plus-a): значок и подпись под ним, плитка ≥ 72 px; последняя — «Все типы». */
export function CategoryTiles({ items, moreHref, moreLabel, className }: { items: readonly CategoryTileItem[]; moreHref?: string; moreLabel?: string; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-[repeat(auto-fill,minmax(min(6.5rem,45%),1fr))] gap-2 sm:gap-3", className)}>
      {items.map((item) => (
        <li key={item.href} className="flex">
          <Link href={item.href} className={tile}>
            <item.icon aria-hidden className="size-7 text-primary" />
            <span>{item.label}</span>
          </Link>
        </li>
      ))}
      {moreHref && (
        <li className="col-span-2 flex min-[34rem]:col-span-1">
          <Link href={moreHref} className={cn(tile, "bg-accent-soft")}>
            <LayoutGrid aria-hidden className="size-7 text-primary" />
            <span>{moreLabel ?? ru.common.ui.categoryTilesMore}</span>
          </Link>
        </li>
      )}
    </ul>
  );
}
