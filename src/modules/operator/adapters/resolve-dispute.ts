import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import type { ResolveDispute } from "@/modules/deal-core";
import { actorOf } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";

const t = ru.operator;

// INTEGRATOR: заменить на deal-core.resolveDispute, когда deal-core-engineer его экспортирует; файл удалить.
// Покрывает режим manual по ADR-002 (денег платформа не двигает): FAVOR_EXECUTOR и PARTIAL — этап ACCEPTED,
// FAVOR_CLIENT — этап REWORK, TERMINATE — сделка TERMINATED. Акт этапа и транши эскроу делает deal-core.
export const resolveDispute: ResolveDispute = async (operator, input) => {
  if (operator.role !== "OPERATOR") fail.forbidden();
  await transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({
      where: { id: input.disputeId },
      select: { stageId: true, deal: { select: { id: true, number: true, totalAmount: true, paymentMode: true, clientId: true, executor: { select: { userId: true } } } } },
    });
    if (!dispute) return fail.notFound();
    const { deal } = dispute;
    if (deal.paymentMode !== "MANUAL") fail.unavailable(t.errors.escrowDisputeLater);
    const decisionAmount = input.decision === "PARTIAL" ? input.decisionAmount : undefined;
    if (input.decision === "PARTIAL" && (decisionAmount === undefined || decisionAmount > deal.totalAmount)) {
      fail.validation(t.errors.amountTooBig);
    }

    const now = new Date();
    expectOneUpdated(
      await tx.dispute.updateMany({
        where: { id: input.disputeId, status: "OPEN" },
        data: { status: "RESOLVED", decision: input.decision, decisionAmount: decisionAmount ?? null, rationale: input.rationale, resolvedById: operator.id, resolvedAt: now },
      }),
      t.errors.disputeResolved,
    );
    const dealStatus: DealStatus = input.decision === "TERMINATE" ? "TERMINATED" : "IN_PROGRESS";
    expectOneUpdated(await tx.deal.updateMany({ where: { id: deal.id, status: "DISPUTE" }, data: { status: dealStatus } }));

    if (dispute.stageId && (input.decision === "FAVOR_EXECUTOR" || input.decision === "PARTIAL")) {
      await tx.stage.updateMany({
        where: { id: dispute.stageId, status: { in: ["IN_PROGRESS", "SUBMITTED", "REWORK"] } },
        data: { status: "ACCEPTED", acceptedAt: now, acceptedBy: operator.id, autoAcceptAt: null },
      });
    } else if (dispute.stageId && input.decision === "FAVOR_CLIENT") {
      await tx.stage.updateMany({
        where: { id: dispute.stageId, status: { in: ["IN_PROGRESS", "SUBMITTED"] } },
        data: { status: "REWORK", reworkNote: input.rationale, autoAcceptAt: null },
      });
    }

    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "dispute.resolved",
      entity: { type: "dispute", id: input.disputeId },
      scope: `deal:${deal.id}`,
      before: { status: "OPEN", deal: "DISPUTE" },
      after: { status: "RESOLVED", decision: input.decision, decisionAmount: decisionAmount ?? null, deal: dealStatus },
      meta: { rationale: input.rationale, stageId: dispute.stageId },
    });
    for (const userId of [deal.clientId, deal.executor.userId]) {
      await notify(tx, { userId, kind: "dispute.resolved", title: t.notifications.disputeTitle, body: t.notifications.disputeBody(deal.number), link: `/deals/${deal.id}` });
    }
  });
};
