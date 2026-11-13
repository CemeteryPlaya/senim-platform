import Link from "next/link";
import { cn } from "./cn";

export type ChipItem = { href: string; label: string; active: boolean };

export type ChipsProps = {
  items: readonly ChipItem[];
  /** Имя группы для диктора («Категории»). */
  label: string;
};

/**
 * Фильтры-ссылки в одну строку. Каждый — обычная ссылка (адрес с параметром фильтра): работает без JavaScript, с
 * кнопкой «Назад» и общим доступом к адресу. Выбранный отмечен `aria-current="true"`, рамкой цвета действия и весом
 * 600 (не одним цветом). На телефоне строка прокручивается вбок, на компьютере переносится. Ряд с отступом p-1 и
 * отрицательным полем: кольцо фокуса не обрезается прокруткой. Серверный компонент.
 */
export function Chips({ items, label }: ChipsProps) {
  return (
    <nav aria-label={label}>
      <ul className="-m-1 flex gap-2 overflow-x-auto p-1 desktop:flex-wrap desktop:overflow-visible">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={item.active ? "true" : undefined}
              className={cn(
                "flex min-h-control items-center rounded-field border border-line-strong bg-surface px-4 text-sub font-medium whitespace-nowrap text-ink no-underline",
                "pressable aria-[current=true]:border-action aria-[current=true]:font-semibold",
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
