"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Раздел «Решение принято» карточки решённого спора. Сразу после решения (адрес с признаком, `focus`) заголовок принимает
 * фокус: форма, где он был, исчезла вместе с обновлением экрана, и без этого фокус ушёл бы на `<body>`. Заголовок с
 * `tabIndex=-1` — цель фокуса, в порядок Tab не входит. Разметка раздела — как у `Section` из kit.
 */
export function ResolvedSection({ title, focus, children }: { title: string; focus: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  return (
    <section aria-labelledby="decision" className="flex min-w-0 flex-col gap-stack-group">
      <h2 id="decision" ref={heading} tabIndex={-1} className="text-title-2 text-ink desktop:scroll-anchor">
        {title}
      </h2>
      {children}
    </section>
  );
}
