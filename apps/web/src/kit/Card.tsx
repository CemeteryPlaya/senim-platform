import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Вид карточки (разбор 3.6):
 * - `plain` — обычная: отступ 16 px (`padded`);
 * - `hero` — одна на экране (текущая сделка, сумма, первый экран профиля мастера): отступ 24 px, место под фото-обложку
 *   16:9 во всю ширину сверху (`cover`) и сумму `text-display-amount` в теле; главная кнопка на компьютере — внутри;
 * - `grouped` — сгруппированный список (как в «Настройках»): без отступа, внутри `List` со строками 56+ px и
 *   разделителями с отступом слева от текста; подсветка строк не выходит за скругление.
 */
export type CardVariant = "plain" | "hero" | "grouped";

export type CardProps = {
  as?: "div" | "section" | "article" | "li";
  variant?: CardVariant;
  /** Только у `plain`: внутренний отступ 16 px; `false` — когда внутри списки или фото во всю ширину. */
  padded?: boolean;
  /**
   * Только у `hero`: фото-обложка (например, последнее фото отчёта мастера) — `<img>`/`next/image` с `object-cover`
   * или `PhotoSlot`. Рамка 16:9 с заливкой `photo-fallback` и внутренним контуром; радиус — карточки, сверху.
   */
  cover?: ReactNode;
  /**
   * Только у `hero` с `cover`: на компьютере обложка — слева на всю высоту карточки, содержимое — справа (две равные
   * колонки, карточка-герой сделки на главной). На телефоне обложка остаётся сверху 16:9.
   */
  coverAside?: boolean;
  /**
   * Карточка целиком кликабельна (обёрнута ссылкой или сама ссылка внутри растянута): на компьютере при наведении —
   * подъём на 2 px и тень `hover` за 200 мс. В покое тени нет (без тени в потоке); на телефоне отклика наведения нет.
   */
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
};

const HOVER =
  "desktop:transition desktop:duration-200 desktop:hover:-translate-y-0.5 desktop:hover:shadow-hover";

/** Белая карточка на тёплом фоне: без рамки и тени, радиус 20 px (на компьютере 22 px). Серверный компонент. */
export function Card({ as: Tag = "div", variant = "plain", padded = true, cover, coverAside = false, interactive = false, className, children }: CardProps) {
  if (variant === "hero") {
    const aside = coverAside && cover !== undefined && cover !== null && cover !== false;
    return (
      <Tag data-card="hero" className={cn("overflow-hidden rounded-card bg-surface", aside && "desktop:grid desktop:grid-cols-2", interactive && HOVER, className)}>
        {cover && <div className={cn("photo-frame aspect-16/9 *:size-full *:object-cover", aside && "desktop:aspect-auto")}>{cover}</div>}
        <div className="flex flex-col gap-4 p-6">{children}</div>
      </Tag>
    );
  }
  return (
    <Tag
      data-card={variant === "grouped" ? "grouped" : undefined}
      className={cn(
        "rounded-card bg-surface",
        variant === "grouped" ? "overflow-hidden" : padded && "p-4",
        interactive && HOVER,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
