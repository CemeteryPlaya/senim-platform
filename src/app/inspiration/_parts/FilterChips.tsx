import Link from "next/link";
import { cn } from "@/ui";

export type Chip = { key: string; label: string; href: string; selected: boolean };

/**
 * Ряд чипов-фильтров: обычные ссылки (работают без JavaScript, адрес можно отправить), выбранный — aria-current.
 * Чипы переносятся на новую строку, а не прокручиваются вбок: при крупном шрифте ничего не прячется за краем.
 * Кандидат в @/ui (Chips) — когда понадобится второму экрану.
 */
export function FilterChips({ id, label, chips }: { id: string; label: string; chips: Chip[] }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="text-base font-semibold text-ink">
        {label}
      </p>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              scroll={false}
              aria-current={chip.selected ? "true" : undefined}
              className={cn(
                "inline-flex min-h-control-sm items-center rounded-full border px-4 text-base font-semibold no-underline",
                chip.selected ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-surface text-ink hover:bg-sunken",
              )}
            >
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
