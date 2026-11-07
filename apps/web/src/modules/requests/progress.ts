import "server-only";
import type { PreContractFlow } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { DEFAULT_FLOW, type FlowStep } from "./flows";
import { preContractView } from "./pre-contract";

/**
 * Шкала шагов заявки для экрана сделки (у сделки есть offerId): сценарий до договора и текущий шаг.
 * Видят заказчик заявки, исполнитель отклика и оператор; остальным — «не найдено» (IDOR).
 */
export async function getFlowProgress(
  user: CurrentUser,
  input: { offerId: string },
): Promise<{ flow: PreContractFlow; steps: readonly FlowStep[]; current: FlowStep | null }> {
  const offer = await db.offer.findUnique({
    where: { id: input.offerId },
    select: {
      id: true,
      priceTiyn: true,
      status: true,
      executor: { select: { userId: true } },
      request: { select: { id: true, status: true, preContractFlow: true, clientId: true } },
    },
  });
  const allowed = offer && (user.role === "OPERATOR" || offer.request.clientId === user.id || offer.executor.userId === user.id);
  if (!offer || !allowed) return fail.notFound(ru.requests.errors.notFound);
  const view = await preContractView(db, offer.request, offer);
  // Путь ТЗ: шкалы сценария нет (current: null — FlowSteps ничего не рисует).
  if (!view) return { flow: DEFAULT_FLOW, steps: [], current: null };
  return { flow: view.flow, steps: view.steps, current: view.current };
}
export type FlowProgress = Awaited<ReturnType<typeof getFlowProgress>>;
