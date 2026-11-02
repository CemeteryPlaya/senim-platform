import "server-only";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { preContractView } from "./pre-contract";

/**
 * Шкала шагов заявки для экрана сделки: сценарий до договора и текущий шаг.
 * Видят заказчик заявки, исполнитель выбранного отклика и оператор; остальным — «не найдено» (IDOR).
 */
export async function getFlowProgress(user: CurrentUser, requestId: string) {
  const r = await db.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      preContractFlow: true,
      clientId: true,
      offers: { where: { status: "ACCEPTED" }, select: { id: true, price: true, status: true, executor: { select: { userId: true } } }, take: 1 },
    },
  });
  const chosen = r?.offers[0] ?? null;
  const allowed = r && (user.role === "OPERATOR" || r.clientId === user.id || chosen?.executor.userId === user.id);
  if (!r || !allowed) return fail.notFound(ru.requests.errors.notFound);
  const view = await preContractView(db, r, chosen);
  return { flow: view.flow, steps: view.steps, current: view.current };
}
export type FlowProgress = Awaited<ReturnType<typeof getFlowProgress>>;
