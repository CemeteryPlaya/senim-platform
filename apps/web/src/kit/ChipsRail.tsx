"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Лента чипов (`<ul>`): единственная клиентская часть `Chips`. При открытии страницы выбранный чип (`aria-current`)
 * прокручивается к центру ленты — иначе на телефоне он мог бы оказаться за краем. Прокручивается сама лента
 * (`scrollTo` по горизонтали), а не страница: `scrollIntoView` сдвинул бы и окно. Мгновенно и до отрисовки
 * (`useLayoutEffect`, `behavior: "auto"`): лента не «едет» на глазах.
 */
export function ChipsRail({ className, children }: { className: string; children: ReactNode }) {
  const rail = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const list = rail.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !active) return;
    const box = list.getBoundingClientRect();
    if (list.scrollWidth <= box.width + 1) return;
    const chip = active.getBoundingClientRect();
    const left = list.scrollLeft + (chip.left - box.left) - (box.width - chip.width) / 2;
    list.scrollTo({ left: Math.max(left, 0), behavior: "auto" });
  }, []);

  return (
    <ul ref={rail} className={className}>
      {children}
    </ul>
  );
}
