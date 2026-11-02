import "server-only";
import type { CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import { isUniqueViolation, transaction } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { auditByUser, links, loadExecutor, requestTitle, requireClient } from "./access";
import { flowOf, MEASURE_DEPOSIT_AMOUNT } from "./flows";
import { DEPOSIT_TRANSITIONS, stored, transition } from "./transitions";

/**
 * Залог за выезд (сценарий 4, ADR-005). Деньги никогда не проходят через площадку: заказчик платит исполнителю
 * напрямую и отмечает это, исполнитель подтверждает получение. Площадка хранит только отметки и журнал.
 * Залог засчитывается в первую оплату по договору на площадке.
 */

const pn = ru.requests.pre.notify;
const withRequest = { request: { include: { furnitureType: { select: { name: true } } } } } as const;

/** Заказчик: «внёс залог исполнителю напрямую». Повтор и гонка — CONFLICT (один залог на отклик). */
export async function markDepositPaid(user: CurrentUser, input: { offerId: string }): Promise<void> {
  requireClient(user);
  try {
    await transaction(async (tx) => {
      const offer = await tx.offer.findFirst({
        where: { id: input.offerId, request: { clientId: user.id } },
        include: { ...withRequest, deposit: true, executor: { select: { userId: true } } },
      });
      if (!offer) return fail.notFound(ru.requests.errors.offerNotFound);
      const to = stored(transition(DEPOSIT_TRANSITIONS, "markPaid", offer.deposit?.status ?? "NONE", "CLIENT", flowOf(offer.request)));
      if (offer.status !== "ACCEPTED" || offer.request.status !== "OFFER_CHOSEN") return fail.conflict();

      const deposit = await tx.measureDeposit.create({ data: { offerId: offer.id, amount: MEASURE_DEPOSIT_AMOUNT, status: to } });
      await auditByUser(tx, user, offer.requestId, {
        action: "deposit.marked_paid",
        entity: { type: "measureDeposit", id: deposit.id },
        after: { status: to, amount: deposit.amount },
        meta: { paidTo: "executor-direct" }, // деньги — напрямую исполнителю, площадка только фиксирует
      });
      const title = requestTitle(offer.request);
      await notify(tx, { userId: offer.executor.userId, kind: "deposit.marked_paid", title: pn.depositMarked.title, body: pn.depositMarked.body(title), link: links.executor(offer.requestId) });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return fail.conflict();
    throw err;
  }
}

/** Исполнитель подтверждает получение залога: MARKED_PAID → CONFIRMED. После этого назначается замер. */
export async function confirmDeposit(user: CurrentUser, input: { offerId: string }): Promise<void> {
  await transaction(async (tx) => {
    const executor = await loadExecutor(tx, user);
    const offer = await tx.offer.findFirst({ where: { id: input.offerId, executorId: executor.id }, include: { ...withRequest, deposit: true } });
    if (!offer) return fail.notFound(ru.requests.errors.offerNotFound);
    const to = stored(transition(DEPOSIT_TRANSITIONS, "confirm", offer.deposit?.status ?? "NONE", "EXECUTOR", flowOf(offer.request)));
    if (!offer.deposit || offer.status !== "ACCEPTED") return fail.conflict();
    const from = offer.deposit.status;

    expectOneUpdated(await tx.measureDeposit.updateMany({ where: { id: offer.deposit.id, status: from }, data: { status: to, confirmedAt: new Date() } }));
    await auditByUser(tx, user, offer.requestId, {
      action: "deposit.confirmed",
      entity: { type: "measureDeposit", id: offer.deposit.id },
      before: { status: from },
      after: { status: to, amount: offer.deposit.amount },
    });
    const title = requestTitle(offer.request);
    await notify(tx, { userId: offer.request.clientId, kind: "deposit.confirmed", title: pn.depositConfirmed.title, body: pn.depositConfirmed.body(title), link: links.client(offer.requestId) });
  });
}
