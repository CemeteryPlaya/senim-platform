import type { Prisma } from "@/generated/prisma/client";
import type { RegistrationStatus, RequestMode, RequestStatus, Segment } from "@/generated/prisma/enums";

/**
 * Единственное место, где решается видимость заявки исполнителю (ADR-003):
 * открытый тендер его сегмента или прямой запрос именно ему. Заявку, на которую
 * он уже откликнулся, исполнитель видит всегда. Свои заявки (тот же человек в роли заказчика, ADR-004)
 * не видит никогда: самосделка запрещена.
 */
export function visibleToExecutor(executor: { id: string; userId: string; segment: Segment | null }): Prisma.RequestWhereInput {
  const tender: Prisma.RequestWhereInput[] = executor.segment ? [{ mode: "TENDER", segment: executor.segment }] : [];
  return { status: "OPEN", clientId: { not: executor.userId }, OR: [...tender, { mode: "DIRECT", targetExecutorId: executor.id }] };
}

export type RequestVisibilityFacts = {
  mode: RequestMode;
  status: RequestStatus;
  segment: Segment | null;
  targetExecutorId: string | null;
  /** У исполнителя есть отклик на эту заявку. */
  viewerHasOffer: boolean;
};

/** То же правило, что visibleToExecutor, для уже загруженной заявки (файлы, ИИ). */
export function executorSeesRequest(
  executor: { id: string; status: RegistrationStatus; segment: Segment | null },
  r: RequestVisibilityFacts,
): boolean {
  if (r.viewerHasOffer) return true;
  if (executor.status !== "APPROVED" || r.status !== "OPEN") return false;
  if (r.mode === "DIRECT") return r.targetExecutorId === executor.id;
  return r.segment !== null && r.segment === executor.segment;
}
