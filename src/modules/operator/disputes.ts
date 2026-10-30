import { scopeHistory } from "@/modules/audit";
import type { ResolveDisputeInput } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertOperator } from "./access";
// INTEGRATOR: после слияния deal-core импортировать resolveDispute из "@/modules/deal-core".
import { resolveDispute as resolveDisputeInDealCore } from "./adapters/resolve-dispute";
import { toAuditView } from "./audit-view";

/** Очередь споров: сначала открытые (по дате открытия), затем решённые. */
export async function listDisputes(user: CurrentUser) {
  assertOperator(user);
  return db.dispute.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      status: true,
      reason: true,
      decision: true,
      createdAt: true,
      resolvedAt: true,
      stage: { select: { title: true } },
      deal: { select: { id: true, number: true, title: true, totalAmount: true, paymentMode: true } },
    },
  });
}

/** Карточка спора: позиции сторон, вложения, этап и вся история сделки из журнала. */
export async function getDisputeCard(user: CurrentUser, disputeId: string) {
  assertOperator(user);
  const dispute = await db.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      status: true,
      reason: true,
      description: true,
      clientPosition: true,
      executorPosition: true,
      decision: true,
      decisionAmount: true,
      rationale: true,
      createdAt: true,
      resolvedAt: true,
      openedBy: { select: { role: true } },
      resolvedBy: { select: { fullName: true } },
      stage: { select: { id: true, title: true, amount: true, status: true } },
      attachments: { select: { id: true, contentType: true, size: true, sha256: true, createdAt: true }, orderBy: { sortOrder: "asc" } },
      deal: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          totalAmount: true,
          paymentMode: true,
          client: { select: { fullName: true } },
          executor: { select: { publicNumber: true, legalName: true } },
          stages: {
            orderBy: { order: "asc" },
            select: { id: true, order: true, title: true, amount: true, status: true, paymentDue: true, payment: { select: { status: true } } },
          },
        },
      },
    },
  });
  if (!dispute) return fail.notFound();
  const history = (await scopeHistory(`deal:${dispute.deal.id}`)).map(toAuditView);
  return { ...dispute, history };
}

export async function resolveDispute(user: CurrentUser, input: ResolveDisputeInput): Promise<void> {
  assertOperator(user);
  await resolveDisputeInDealCore(user, input);
}
