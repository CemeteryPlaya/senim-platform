import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type ReviewExecutorRegistration } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";

const n = ru.operator.notifications;

// INTEGRATOR: заменить на identity.reviewExecutorRegistration, когда identity-engineer его экспортирует;
// этот файл удалить. Форма записей аудита совпадает с сидом (executor.approved / executor.rejected).
export const reviewExecutorRegistration: ReviewExecutorRegistration = async (operator, profileId, decision) => {
  if (operator.role !== "OPERATOR") fail.forbidden();
  await transaction(async (tx) => {
    const profile = await tx.executorProfile.findUnique({ where: { id: profileId }, select: { userId: true } });
    if (!profile) return fail.notFound();

    const now = new Date();
    const updated = await tx.executorProfile.updateMany({
      where: { id: profileId, status: "PENDING" },
      data: decision.approve
        ? { status: "APPROVED", segment: decision.segment, rejectReason: null, reviewedAt: now }
        : { status: "REJECTED", segment: null, rejectReason: decision.reason, reviewedAt: now },
    });
    expectOneUpdated(updated, ru.operator.errors.alreadyReviewed);

    const entity = { type: "executor", id: profileId };
    const scope = `executor:${profileId}`;
    if (decision.approve) {
      await recordAudit(tx, {
        actor: actorOf(operator),
        action: "executor.approved",
        entity,
        scope,
        before: { status: "PENDING", segment: null },
        after: { status: "APPROVED", segment: decision.segment },
      });
      await notify(tx, { userId: profile.userId, kind: "executor.approved", title: n.approvedTitle, body: n.approvedBody, link: "/executor/profile" });
    } else {
      await recordAudit(tx, {
        actor: actorOf(operator),
        action: "executor.rejected",
        entity,
        scope,
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
        meta: { reason: decision.reason },
      });
      await notify(tx, {
        userId: profile.userId,
        kind: "executor.rejected",
        title: n.rejectedTitle,
        body: n.rejectedBody(decision.reason),
        link: "/executor/profile",
      });
    }
  });
};
