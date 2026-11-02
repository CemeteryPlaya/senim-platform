import type { PreContractFlow } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { FlowStep } from "@/modules/requests/client";
import { Stepper } from "@/ui";

const t = ru.requests.pre;

export type FlowStepsProps = { flow: PreContractFlow; steps: readonly FlowStep[]; current: FlowStep | null };

/**
 * Шкала этапов заявки по её сценарию до договора (ADR-005): одна на экранах заявки и сделки у заказчика
 * и исполнителя. Шаги — из таблицы FLOW_STEPS (modules/requests/flows.ts), текущий выделен.
 * Отменённая заявка шкалы не показывает.
 */
export function FlowSteps({ flow, steps, current }: FlowStepsProps) {
  if (current === null) return null;
  return (
    <section aria-label={t.progressLabel} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
      <p className="text-base text-ink-soft">{t.flowLabel(t.flowNames[flow])}</p>
      <Stepper steps={steps.map((s) => t.steps[s])} current={steps.indexOf(current)} label={t.progressLabel} />
    </section>
  );
}
