import type { PreContractFlow } from "@/generated/prisma/enums";
import type { StageTemplate } from "@/modules/deal-core";

/**
 * Первый этап договора по сценарию до договора (ADR-005): там, где исполнитель не был на объекте до договора,
 * договор начинается с его выезда. Условия пересчёта записаны в описании этапа — оно попадает в договор.
 */

type TemplateStage = StageTemplate["stages"][number];

/** Доля этапа «Замер и проект» в сценарии «договор до замера»: небольшая оплата выезда и проекта. */
export const MEASURE_AND_PROJECT_SHARE = 10;

const FIRST_STAGE: Partial<Record<PreContractFlow, TemplateStage>> = {
  PLATFORM_MEASURER: {
    title: "Контрольный замер",
    description:
      "Исполнитель сверяет на объекте размеры замерщика площадки. Если расхождение больше 2 %, проект пересчитывается, разницу в цене покрывает площадка.",
    sharePercent: 0,
    paymentDue: "ON_ACCEPTANCE",
  },
  SELF_MEASURE: {
    title: "Контрольный замер",
    description:
      "Исполнитель сверяет на объекте размеры, которые снял заказчик. Если расхождение больше 5 %, цена пересчитывается по ставке этого договора.",
    sharePercent: 0,
    paymentDue: "ON_ACCEPTANCE",
  },
  CONTRACT_FIRST: {
    title: "Замер и проект",
    description:
      "Выезд, замер и проект. Утверждённый проект фиксирует цену в пределах ±15 % от цены договора; если цена выходит за допуск, любая сторона выходит без штрафа, а заказчик оплачивает только этот этап.",
    sharePercent: MEASURE_AND_PROJECT_SHARE,
    paymentDue: "ON_ACCEPTANCE",
  },
};

/** Доля первого этапа берётся у первого оплачиваемого этапа, которому её хватает: сумма долей остаётся 100 %. */
function takeShare(stages: readonly TemplateStage[], share: number): TemplateStage[] {
  const donor = stages.findIndex((s) => s.sharePercent >= share);
  if (donor < 0) throw new Error(`Нет этапа с долей не меньше ${share}%`);
  return stages.map((s, i) => (i === donor ? { ...s, sharePercent: s.sharePercent - share } : s));
}

/** Шаблон этапов для договора по сценарию: с первым этапом выезда исполнителя, если он нужен. */
export function templateForFlow(template: StageTemplate, flow: PreContractFlow): StageTemplate {
  const first = FIRST_STAGE[flow];
  if (!first) return template;
  return { ...template, stages: [first, ...takeShare(template.stages, first.sharePercent)] };
}

/** Название первого этапа сценария (для подписи «первый этап договора»); null — этапы как в шаблоне. */
export function firstStageTitle(flow: PreContractFlow): string | null {
  return FIRST_STAGE[flow]?.title ?? null;
}
