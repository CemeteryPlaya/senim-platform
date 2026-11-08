import type { ReactNode } from "react";
import { cn } from "./cn";
import { StickyAction } from "./StickyAction";

export type DetailColumnsProps = {
  /** Верх во всю ширину (ход сделки, фото работы). */
  lead?: ReactNode;
  /** Правая колонка десктопа; на телефоне — сразу под верхом (деньги, цена и параметры). */
  aside: ReactNode;
  /** Левая колонка десктопа; на телефоне — ниже (события, документы, работы). */
  main: ReactNode;
  /** Единственное главное действие экрана: на телефоне закреплено внизу (StickyAction), на десктопе — под правой колонкой. */
  action?: ReactNode;
  className?: string;
};

// Сетка десктопа: правая колонка (aside, затем действие) занимает свои строки по высоте, левая (main) тянется
// через них и последнюю гибкую строку — поэтому высоты колонок не связаны. Классы — целиком (Tailwind ищет строки).
const GRID = {
  lead: {
    root: "lg:grid-rows-[auto_auto_auto_1fr]",
    aside: "lg:row-start-2",
    main: "lg:row-start-2 lg:row-span-3",
    action: "lg:row-start-3",
  },
  bare: {
    root: "lg:grid-rows-[auto_auto_1fr]",
    aside: "lg:row-start-1",
    main: "lg:row-start-1 lg:row-span-3",
    action: "lg:row-start-2",
  },
} as const;

/**
 * Экран деталей «B + A» (макет b-plus-a, сделка и карточка работы): телефон — одна колонка в порядке верх → aside →
 * main → действие (последним, чтобы StickyAction держался у нижнего края всю прокрутку); десктоп (≥ 1024 px) — верх во
 * всю ширину и две колонки 1,2 : 1, слева main, справа aside и под ним действие. Порядок в разметке один — клавиатура
 * и диктор идут так же, как на телефоне.
 */
export function DetailColumns({ lead, aside, main, action, className }: DetailColumnsProps) {
  const g = lead ? GRID.lead : GRID.bare;
  return (
    <div className={cn("flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8", g.root, className)}>
      {lead && <div className="min-w-0 lg:col-span-2 lg:row-start-1">{lead}</div>}
      <div className={cn("flex min-w-0 flex-col gap-6 lg:col-start-2", g.aside)}>{aside}</div>
      <div className={cn("flex min-w-0 flex-col gap-6 lg:col-start-1", g.main)}>{main}</div>
      {action && <StickyAction className={cn("lg:col-start-2", g.action)}>{action}</StickyAction>}
    </div>
  );
}
