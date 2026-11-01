import type { PaymentDue } from "@/generated/prisma/enums";

/**
 * Шаблон этапов приходит в deal-core из вертикали (verticals/furniture) как конфигурация.
 * Ядро не знает, что делается: мебель, ремонт или что-то ещё.
 */
export type StageTemplate = {
  key: string;
  name: string;
  description: string;
  stages: readonly {
    title: string;
    description: string;
    /** Доля суммы сделки в процентах; 0 — этап без оплаты (только отчёт). */
    sharePercent: number;
    paymentDue: PaymentDue;
  }[];
};

export type PlannedStage = {
  order: number;
  title: string;
  description: string;
  amount: number;
  paymentDue: PaymentDue;
};

/** Делит сумму по долям шаблона. Остаток от округления уходит последнему оплачиваемому этапу. */
export function planStages(template: StageTemplate, totalAmount: number): PlannedStage[] {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) throw new Error("Сумма сделки должна быть положительной");
  const shares = template.stages.reduce((sum, s) => sum + s.sharePercent, 0);
  if (shares !== 100) throw new Error(`Доли этапов шаблона «${template.key}» дают ${shares}%, а нужно 100%`);

  const stages = template.stages.map((s, i) => ({
    order: i + 1,
    title: s.title,
    description: s.description,
    amount: Math.floor((totalAmount * s.sharePercent) / 100),
    paymentDue: s.paymentDue,
  }));
  const remainder = totalAmount - stages.reduce((sum, s) => sum + s.amount, 0);
  // Доли дают 100%, значит оплачиваемый этап (доля больше нуля) есть всегда.
  stages[template.stages.findLastIndex((s) => s.sharePercent > 0)].amount += remainder;
  return stages;
}
