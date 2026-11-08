import Link from "next/link";
import { cn } from "./cn";

export type FilterChipItem = { href: string; label: string; active: boolean };

/**
 * Чипы-фильтры ссылками (серверная страница, фильтр в адресе). Активный — зелёный, aria-current="page"; ≥ 48 px.
 * Переносятся на новую строку, а не прокручиваются вбок: при крупном шрифте всё на виду.
 */
export function FilterChips({ items, label, className }: { items: readonly FilterChipItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={`${item.href}|${item.label}`}>
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-control-sm items-center rounded-chip border px-4 text-base font-semibold no-underline transition-colors duration-150",
                item.active ? "border-primary bg-primary text-on-primary hover:bg-primary-hover" : "border-line bg-surface text-ink hover:border-line-strong",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
