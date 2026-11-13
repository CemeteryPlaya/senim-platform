import Link from "next/link";
import { ChipsRail } from "./ChipsRail";
import { cn } from "./cn";

export type ChipItem = { href: string; label: string; active: boolean };

export type ChipsProps = {
  items: readonly ChipItem[];
  /** Имя группы для диктора («Категории»). */
  label: string;
};

/**
 * Фильтры-ссылки без обводок: обычный чип — заливка `line` и текст `ink`, радиус 12 px; выбранный — заливка `action`,
 * текст `on-action`, вес 600 и `aria-current="true"`. Каждый чип — обычная ссылка (адрес с параметром фильтра): работает
 * без JavaScript, с кнопкой «Назад» и общим доступом к адресу.
 *
 * Телефон: высота 48 px, лента выходит за поля экрана до его края (`rail-bleed`, внутренний отступ тот же), прокручивается
 * вбок, последний видимый чип уходит за край; выбранный при открытии прокручен в видимую часть (`ChipsRail`, единственная
 * клиентская часть). Компьютер: высота 36 px, строки переносятся. Ряд с вертикальным отступом `py-1` и отрицательным
 * полем: кольцо фокуса не обрезается прокруткой.
 */
export function Chips({ items, label }: ChipsProps) {
  return (
    <nav aria-label={label}>
      <ChipsRail className="-my-1 flex gap-2 overflow-x-auto py-1 mobile:rail-bleed desktop:flex-wrap desktop:overflow-visible">
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={item.active ? "true" : undefined}
              className={cn(
                "flex min-h-control items-center rounded-field px-4 text-sub whitespace-nowrap no-underline pressable desktop:min-h-control-sm",
                item.active ? "bg-action font-semibold text-on-action" : "bg-line font-medium text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ChipsRail>
    </nav>
  );
}
