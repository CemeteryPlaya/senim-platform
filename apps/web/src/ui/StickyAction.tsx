"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

export type StickyActionProps = {
  /** Главная кнопка экрана (одна) и, при нужде, пояснение к ней. */
  children: ReactNode;
  className?: string;
};

/** Зазор между закреплённым блоком и нижней панелью — bottom-[calc(var(--tabbar-h)+0.75rem)] в классах ниже. */
const GAP_PX = 12;

/**
 * Слот главной кнопки экрана деталей. Ставится последним в содержимом экрана (внутри его контейнера).
 * Телефон и планшет: прижат к нижнему краю над нижней панелью (--tabbar-h: высота панели и безопасной зоны, ставит
 * MobileTabBar; без панели — 0). Он остаётся в потоке, поэтому в конце страницы лежит после содержимого и
 * занимает своё место: ничего не закрывает, отдельный отступ не нужен. Десктоп (≥ 1024 px) и низкий экран
 * (ниже 28em: ландшафт, крупный шрифт) — обычный блок в потоке.
 * Пока блок закреплён, его высота с зазором лежит в --sticky-h на <html>: scroll-padding-bottom (globals.css) учитывает её,
 * и поле, получившее фокус с клавиатуры, остаётся над блоком, а не под ним. В потоке --sticky-h равна 0.
 */
export function StickyAction({ children, className }: StickyActionProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const pinned = getComputedStyle(el).position === "sticky";
      root.style.setProperty("--sticky-h", pinned ? `${el.offsetHeight + GAP_PX}px` : "0px");
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--sticky-h");
    };
  }, []);

  return (
    <div
      ref={ref}
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
