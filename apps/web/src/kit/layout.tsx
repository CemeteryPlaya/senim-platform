import type { ReactNode } from "react";
import type { Device } from "@/platform/device";
import { cn } from "./cn";

/**
 * Раскладка экранов. Версии различаются только вариантами desktop: и mobile: (tokens.css) — брейкпоинтов по ширине
 * нет: узкое окно компьютера остаётся компьютерной раскладкой (спека редизайна, раздел 5).
 */

export type StackGap = "tight" | "group" | "section";

const GAPS: Record<StackGap, string> = {
  tight: "gap-stack-tight", // 8 px
  group: "gap-stack-group", // 12 px — карточки одной группы
  section: "gap-stack-section", // 24 px на телефоне, 32 px на компьютере
};

export type StackProps = { gap?: StackGap; className?: string; children: ReactNode };

/** Вертикальный поток с отступом по шкале. По умолчанию — зазор группы карточек (12 px). */
export function Stack({ gap = "group", className, children }: StackProps) {
  return <div className={cn("flex min-w-0 flex-col", GAPS[gap], className)}>{children}</div>;
}

export type SplitProps = {
  main: ReactNode;
  aside: ReactNode;
  /** Боковая колонка прилипает под шапкой, пока прокручивается основная (только компьютер). */
  stickyAside?: boolean;
};

/**
 * Две колонки на компьютере: `main` и `aside` в сетке 1,5 : 1 с зазором 24 px, выровнены по верху (эталон
 * desktop-layout.html, вариант A). На телефоне — одна колонка: `main`, затем `aside` через отступ раздела.
 */
export function Split({ main, aside, stickyAside = false }: SplitProps) {
  return (
    <div className="flex flex-col gap-stack-section desktop:grid desktop:grid-cols-split desktop:items-start desktop:gap-split">
      <div className="min-w-0">{main}</div>
      <div className={cn("min-w-0", stickyAside && "desktop:sticky-aside")}>{aside}</div>
    </div>
  );
}

/**
 * Узкая колонка на компьютере — до 560 px, по левому краю: формы, строки «подпись — значение», списки помощи, чтобы
 * строки не растягивались на всю ширину. На телефоне ничего не делает.
 */
export function Narrow({ children }: { children: ReactNode }) {
  return <div className="desktop:max-w-narrow">{children}</div>;
}

export type SidebarProps = { aside: ReactNode; device: Device; children: ReactNode };

/**
 * Узкая левая колонка и основная: на компьютере `aside` (15 rem, прилипает при прокрутке — `sticky-aside`, как у `Split`)
 * и `children` на остальную ширину, зазор 24 px, по верху. На телефоне выводятся ТОЛЬКО `children`: `aside` в разметку не
 * попадает (версию выбирает вызывающий по `device`, поэтому скрытого дубля в DOM нет). Для списков фильтров каталога.
 */
export function Sidebar({ aside, device, children }: SidebarProps) {
  if (device === "mobile") return <div className="min-w-0">{children}</div>;
  return (
    <div className="desktop:grid desktop:grid-cols-sidebar desktop:items-start desktop:gap-split">
      <div className="min-w-0 desktop:sticky-aside">{aside}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type SectionProps = {
  title: string;
  /** Якорь: id заголовка (ссылки вида #id); раздел подписан им. */
  id?: string;
  children: ReactNode;
};

/**
 * Раздел экрана: заголовок h2 и содержимое через зазор группы (12 px). Заголовок стоит ровно по левому краю карточек —
 * своих отступов у него нет.
 */
export function Section({ title, id, children }: SectionProps) {
  return (
    <section className="flex min-w-0 flex-col gap-stack-group" aria-labelledby={id}>
      <h2 id={id} className={cn("text-section text-ink", id && "desktop:scroll-anchor")}>{title}</h2>
      {children}
    </section>
  );
}
