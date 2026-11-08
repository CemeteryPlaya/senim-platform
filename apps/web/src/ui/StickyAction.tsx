import type { ReactNode } from "react";
import { cn } from "./cn";

export type StickyActionProps = {
  /** Главная кнопка экрана (одна) и, при нужде, пояснение к ней. */
  children: ReactNode;
  className?: string;
};

/**
 * Слот главной кнопки экрана деталей. Ставится последним в содержимом экрана (внутри его контейнера).
 * Телефон и планшет: прижат к нижнему краю над нижней панелью (--tabbar-h: высота панели и безопасной зоны, ставит
 * MobileTabBar; без панели — 0). Он остаётся в потоке, поэтому в конце страницы лежит после содержимого и
 * занимает своё место: ничего не закрывает, отдельный отступ не нужен. Десктоп (≥ 1024 px) и низкий экран
 * (ниже 28em: ландшафт, крупный шрифт) — обычный блок в потоке.
 */
export function StickyAction({ children, className }: StickyActionProps) {
  return (
    <div
      data-sticky-action
      className={cn(
        "z-20 flex flex-col gap-3 rounded-card border border-line bg-surface p-4",
        "bottom-[calc(var(--tabbar-h)+0.75rem)] max-lg:shadow-raised max-lg:[@media(min-height:28em)]:sticky",
        className,
      )}
    >
      {children}
    </div>
  );
}
