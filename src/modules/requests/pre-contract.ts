import "server-only";
import type { PreContractFlow, RequestStatus } from "@/generated/prisma/enums";
import type { Db } from "@/platform/db";
import { isEnabled } from "@/platform/features";
import { currentFlowStep, FLOW_STEPS, flowRules, MEASURE_DEPOSIT_AMOUNT, toleranceRange, wholeKzt } from "./flows";
import { projectVersions } from "./projects";

/**
 * Состояние шагов до договора для экранов заявки (заказчик и исполнитель выбранного отклика) и сделки:
 * сценарий, шкала шагов с текущим, замер площадки, залог, версии проекта, допуск цены.
 * Права проверяет вызывающий: offer — выбранный отклик заказчика или отклик самого исполнителя.
 * null — шагов до договора нет: заявка идёт путём ТЗ (торг → оферта) или флаг preContractFlows выключен.
 */
export async function preContractView(
  tx: Db,
  r: { id: string; status: RequestStatus; preContractFlow: PreContractFlow | null },
  offer: { id: string; priceTiyn: bigint; status: string } | null,
) {
  const flow = r.preContractFlow;
  if (flow === null || !isEnabled("preContractFlows")) return null;
  const rules = flowRules(flow);
  const chosen = offer?.status === "ACCEPTED" ? offer : null;
  const [site, deposit, projects, measurement, deal] = await Promise.all([
    tx.siteMeasurement.findUnique({ where: { requestId: r.id } }),
    chosen ? tx.measureDeposit.findUnique({ where: { offerId: chosen.id } }) : null,
    chosen ? projectVersions(tx, chosen.id) : [],
    chosen ? tx.measurement.findUnique({ where: { offerId: chosen.id }, select: { status: true } }) : null,
    tx.deal.findUnique({ where: { requestId: r.id }, select: { priceTiyn: true } }),
  ]);
  const approved = projects.find((p) => p.status === "APPROVED") ?? null;
  const current = currentFlowStep(flow, {
    status: r.status,
    measurementDone: measurement?.status === "DONE",
    depositConfirmed: deposit?.status === "CONFIRMED",
    projectApproved: approved !== null,
  });
  const contractPrice = deal ? wholeKzt(deal.priceTiyn) : chosen ? wholeKzt(chosen.priceTiyn) : null;
  return {
    flow,
    rules,
    steps: FLOW_STEPS[flow],
    current,
    /** Замер площадки: размеры и заметки видят заказчик и исполнители; кто замерял — нет. */
    site: site && {
      status: site.status,
      widthCm: site.widthCm,
      heightCm: site.heightCm,
      depthCm: site.depthCm,
      notes: site.notes,
      doneAt: site.doneAt,
    },
    deposit: deposit && { status: deposit.status, amount: deposit.amount },
    depositAmount: MEASURE_DEPOSIT_AMOUNT,
    projects,
    approvedProject: approved,
    /** Допуск цены «договора до замера»: от цены договора (или отклика до договора). */
    tolerance: !rules.projectBeforeContract && contractPrice !== null ? { price: contractPrice, ...toleranceRange(contractPrice) } : null,
  };
}
export type PreContractView = NonNullable<Awaited<ReturnType<typeof preContractView>>>;
