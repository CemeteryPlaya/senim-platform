import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "./cn";

export type FilterListProps = {
  /** Заголовок группы; он же имя навигации для диктора. */
  title: string;
  items: readonly { href: string; label: string; active: boolean }[];
};

/**
 * Список фильтров для левой колонки на компьютере: заголовок 15 px / 600 и строки-ссылки: 48 px на телефоне, 36 px на компьютере. Выбранная строка —
 * вес 600, галочка справа и `aria-current="true"` (не одним весом). Серверный компонент.
 */
export function FilterList({ title, items }: FilterListProps) {
  return (
    <nav aria-label={title} className="flex flex-col gap-1">
      <p className="text-sub font-semibold text-ink">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? "true" : undefined}
              className={cn(
                "flex min-h-control items-center desktop:min-h-control-sm justify-between gap-2 text-sub text-ink no-underline hover:underline",
                item.active && "font-semibold",
              )}
            >
              <span className="min-w-0">{item.label}</span>
              {item.active && <Check aria-hidden className="size-4 shrink-0" />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
