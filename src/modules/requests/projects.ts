import "server-only";
import { maskContacts, sanitizeExecutorText } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { isUniqueViolation, transaction, type Db, type Tx } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { formatMoney } from "@/ui/format";
import { auditByUser, links, loadExecutor, requestTitle, requireClient } from "./access";
import { flowOf, flowRules, toleranceRange, withinTolerance } from "./flows";
import { costLinesSchema, type SubmitProjectInput } from "./pre-contract-schema";
import { PROJECT_TRANSITIONS, stored, transition, type ProjectState } from "./transitions";
import type { PreContractFlow, RequestStatus } from "@/generated/prisma/enums";

/**
 * Утверждение проекта (ADR-005) — общий шаг всех сценариев. Исполнитель выбранного отклика отправляет версию проекта,
 * заказчик утверждает или просит изменить (комментарий), тогда исполнитель отправляет новую версию.
 * Версии — строки Project с уникальным (offerId, version): две одновременные отправки дают один успех.
 */

const pe = ru.requests.pre.errors;
const pn = ru.requests.pre.notify;

/** Шаг проекта по сценарию: до договора (после замера, если он есть) или — в «договоре до замера» — после договора. */
function projectStepOpen(flow: PreContractFlow, status: RequestStatus, measurementDone: boolean): boolean {
  const r = flowRules(flow);
  if (!r.projectBeforeContract) return status === "CONTRACTING" || status === "CLOSED";
  if (status !== "OFFER_CHOSEN" && status !== "MEASURING") return false;
  return !r.executorVisit || measurementDone;
}

async function latestVersion(tx: Db, offerId: string) {
  return tx.project.findFirst({ where: { offerId }, orderBy: { version: "desc" } });
}

/** Цена договора, от которой считается допуск в «договоре до замера». */
async function contractPrice(tx: Db, requestId: string): Promise<number | null> {
  const deal = await tx.deal.findUnique({ where: { requestId }, select: { totalAmount: true } });
  return deal?.totalAmount ?? null;
}

async function checkTolerance(tx: Tx, flow: PreContractFlow, requestId: string, total: number) {
  if (flowRules(flow).projectBeforeContract) return;
  const price = await contractPrice(tx, requestId);
  if (price === null) return fail.conflict(pe.projectNotNow);
  if (!withinTolerance(total, price)) {
    const { min, max } = toleranceRange(price);
    fail.validation(pe.outOfTolerance(formatMoney(min), formatMoney(max)));
  }
}

/** Исполнитель отправляет проект (первую или новую версию после «Внести изменения»). */
export async function submitProject(user: CurrentUser, input: SubmitProjectInput): Promise<{ projectId: string }> {
  try {
    return await transaction(async (tx) => {
      const executor = await loadExecutor(tx, user);
      const offer = await tx.offer.findFirst({
        where: { id: input.offerId, executorId: executor.id },
        include: { request: { include: { furnitureType: { select: { name: true } } } }, measurement: { select: { status: true } } },
      });
      if (!offer) return fail.notFound(ru.requests.errors.offerNotFound);
      const r = offer.request;
      const flow = flowOf(r);
      if (offer.status !== "ACCEPTED" || !projectStepOpen(flow, r.status, offer.measurement?.status === "DONE")) return fail.conflict(pe.projectNotNow);
      const latest = await latestVersion(tx, offer.id);
      const to = stored(transition(PROJECT_TRANSITIONS, "submit", latest?.status ?? "NONE", "EXECUTOR", flow));
      await checkTolerance(tx, flow, r.id, input.totalPrice);

      // Текст проекта видит заказчик до договора: без контактов и наименования исполнителя.
      const clean = async (text: string) => (await sanitizeExecutorText(tx, executor.id, text)).text;
      const costLines = await Promise.all(input.costLines.map(async (l) => ({ title: await clean(l.title), amount: l.amount })));
      const project = await tx.project.create({
        data: {
          requestId: r.id,
          offerId: offer.id,
          version: (latest?.version ?? 0) + 1,
          status: to,
          materials: await clean(input.materials),
          costLines,
          durationDays: input.durationDays,
          warrantyMonths: input.warrantyMonths,
          totalPrice: input.totalPrice,
        },
      });
      await auditByUser(tx, user, r.id, {
        action: "project.submitted",
        entity: { type: "project", id: project.id },
        before: { status: latest?.status ?? "NONE" },
        after: { status: to, version: project.version, totalPrice: project.totalPrice },
      });
      const title = requestTitle(r);
      await notify(tx, { userId: r.clientId, kind: "project.submitted", title: pn.projectSubmitted.title, body: pn.projectSubmitted.body(title), link: links.client(r.id) });
      return { projectId: project.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict();
    throw err;
  }
}

type Decision = { action: "approve"; comment?: undefined } | { action: "requestChanges"; comment: string };

/** Решение заказчика по версии проекта: SUBMITTED → APPROVED или CHANGES_REQUESTED. Двойной клик — CONFLICT. */
async function decide(user: CurrentUser, projectId: string, decision: Decision): Promise<void> {
  requireClient(user);
  await transaction(async (tx) => {
    const p = await tx.project.findFirst({
      where: { id: projectId, request: { clientId: user.id } },
      include: { request: { include: { furnitureType: { select: { name: true } } } }, offer: { select: { status: true, executor: { select: { userId: true } } } } },
    });
    if (!p) return fail.notFound(pe.projectNotFound);
    const flow = flowOf(p.request);
    const to = stored(transition(PROJECT_TRANSITIONS, decision.action, p.status as ProjectState, "CLIENT", flow));
    if (p.offer.status !== "ACCEPTED" || p.request.status === "CANCELLED") return fail.conflict();
    const changeNote = decision.comment === undefined ? null : maskContacts(decision.comment).text;

    expectOneUpdated(await tx.project.updateMany({ where: { id: p.id, status: p.status }, data: { status: to, changeNote, decidedAt: new Date() } }));
    await auditByUser(tx, user, p.requestId, {
      action: decision.action === "approve" ? "project.approved" : "project.changes_requested",
      entity: { type: "project", id: p.id },
      before: { status: p.status },
      after: { status: to, version: p.version, totalPrice: p.totalPrice },
    });
    const text = decision.action === "approve" ? pn.projectApproved : pn.projectChanges;
    await notify(tx, { userId: p.offer.executor.userId, kind: `project.${to.toLowerCase()}`, title: text.title, body: text.body(requestTitle(p.request)), link: links.executor(p.requestId) });
  });
}

export const approveProject = (user: CurrentUser, input: { projectId: string }) => decide(user, input.projectId, { action: "approve" });
export const requestProjectChanges = (user: CurrentUser, input: { projectId: string; comment: string }) =>
  decide(user, input.projectId, { action: "requestChanges", comment: input.comment });

/** Версии проекта по отклику, новые сверху. Права на отклик проверяет вызывающий. */
export async function projectVersions(tx: Db, offerId: string) {
  const rows = await tx.project.findMany({ where: { offerId }, orderBy: { version: "desc" } });
  return rows.map((p) => ({
    id: p.id,
    version: p.version,
    status: p.status,
    materials: p.materials,
    costLines: costLinesSchema.parse(p.costLines),
    durationDays: p.durationDays,
    warrantyMonths: p.warrantyMonths,
    totalPrice: p.totalPrice,
    changeNote: p.changeNote,
    createdAt: p.createdAt,
  }));
}
export type ProjectVersion = Awaited<ReturnType<typeof projectVersions>>[number];

/** Утверждённая версия проекта по отклику (цена договора). */
export async function approvedProject(tx: Db, offerId: string) {
  return tx.project.findFirst({ where: { offerId, status: "APPROVED" }, orderBy: { version: "desc" } });
}
