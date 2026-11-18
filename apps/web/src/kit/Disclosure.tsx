import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type DisclosureProps = {
  /** Вопрос: подпись раскрывающей строки (summary). */
  title: string;
  /** Раскрыт сразу; по умолчанию закрыт. */
  open?: boolean;
  /** Ответ. Лежит в разметке и при закрытом состоянии (виден поиску и диктору после раскрытия). */
  children: ReactNode;
};

/**
 * Раскрывающийся ответ: нативный `<details>`/`<summary>` — открывается Enter и пробелом, диктор читает состояние,
 * скрипты не нужны. Подпись — цель не ниже 48 px, справа шеврон: при раскрытии поворачивается (при
 * `prefers-reduced-motion` — без анимации). Серверный компонент. Ставьте в `DisclosureList`: рамки у него нет.
 */
export function Disclosure({ title, open = false, children }: DisclosureProps) {
  return (
    <details open={open || undefined} className="group border-b border-line last:border-b-0">
      <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-4 px-card py-3 text-headline text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none")} />
      </summary>
      <div className="flex flex-col gap-3 px-card pb-5 text-body text-muted">{children}</div>
    </details>
  );
}

/** Группа вопросов на одной подложке: раскрывающие строки с разделителями, у последней разделителя нет. */
export function DisclosureList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col overflow-hidden rounded-card bg-surface">
      {children}
    </div>
  );
}
