import type { PaymentOperation } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { db, lockDealRow, transaction, type Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { escrowStatusOf } from "./escrow-status";
import { paymentModeOf, railModeOf } from "./modes";
import type { OperationResult, RailMode, RailWebhookEvent } from "./rail";
import { railFor } from "./rails";

/**
 * Денежные операции по счёту сделки (ADR-002):
 *  1) в транзакции перехода deal-core создаёт PaymentOperation с уникальным idempotencyKey (requestOperation);
 *  2) после фиксации — вызов рельса с тем же ключом (executeOperation); повтор не двигает деньги второй раз;
 *  3) результат фиксируется под блокировкой сделки; итог PENDING дожидается вебхука.
 * О выполненной операции payments сообщает через хук (deal-core.onPaymentSettled) — без импорта deal-core.
 */

export type SettledOperation = Pick<
  PaymentOperation,
  "id" | "dealId" | "stageId" | "kind" | "amount" | "idempotencyKey" | "externalRef"
> & { status: "SUCCEEDED" | "FAILED" };

/** Вызывается в той же транзакции, где операция стала SUCCEEDED или FAILED. */
export type SettledHook = (tx: Tx, op: SettledOperation) => Promise<void>;

const ACTOR = SYSTEM("payments");

/** Одна очередь изменений на сделку: и deal-core, и payments блокируют строку сделки первой. */
async function lockDeal(tx: Tx, dealId: string) {
  await lockDealRow(tx, dealId);
}

export type OperationRequest = {
  dealId: string;
  stageId?: string;
  kind: "RELEASE" | "REFUND";
  amount: number;
  idempotencyKey: string;
};

/** Шаг 1: запись операции в журнал. Повтор с тем же ключом ничего не создаёт. Возвращает, создана ли запись. */
export async function requestOperation(tx: Tx, input: OperationRequest): Promise<boolean> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) return false;
  const created = await tx.paymentOperation.createMany({
    data: [{ dealId: input.dealId, stageId: input.stageId, kind: input.kind, amount: input.amount, idempotencyKey: input.idempotencyKey }],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    await recordAudit(tx, {
      actor: ACTOR,
      action: "payment.operation.requested",
      entity: { type: "paymentOperation", id: input.idempotencyKey },
      scope: `deal:${input.dealId}`,
      after: { kind: input.kind, amount: input.amount, stageId: input.stageId ?? null },
    });
  }
  return created.count === 1;
}

/** Ключи операций сделки, которые ещё не отправлены в банк, — в порядке создания. */
export async function pendingOperationKeys(dealId: string): Promise<string[]> {
  const ops = await db.paymentOperation.findMany({
    where: { dealId, status: "PENDING", kind: { not: "DEPOSIT" }, externalRef: null },
    orderBy: { createdAt: "asc" },
    select: { idempotencyKey: true },
  });
  return ops.map((o) => o.idempotencyKey);
}

/**
 * Шаги 2–3: отправить операцию в банк и зафиксировать результат. Идемпотентно: операция не в PENDING —
 * ничего не делаем; два параллельных вызова получают от банка один и тот же результат по ключу.
 * Банк недоступен — исключение (задача повторит позже).
 */
export async function executeOperation(idempotencyKey: string, onSettled: SettledHook) {
  const op = await db.paymentOperation.findUnique({ where: { idempotencyKey }, include: { deal: { include: { escrow: true } } } });
  if (!op || op.status !== "PENDING" || op.kind === "DEPOSIT" || op.externalRef) return op?.status ?? null;
  const account = op.deal.escrow;
  if (!account) throw new Error(`У сделки ${op.dealId} нет счёта для операции ${idempotencyKey}`);

  const rail = railFor(railModeOf(account.rail));
  const common = { externalId: account.externalId, dealId: op.dealId, amount: op.amount, idempotencyKey };
  const result =
    op.kind === "RELEASE"
      ? await rail.releaseTranche({ ...common, stageId: op.stageId ?? undefined })
      : await rail.refund({ ...common, reason: idempotencyKey });

  return transaction(async (tx) => {
    await lockDeal(tx, op.dealId);
    return applyResult(tx, idempotencyKey, result, onSettled);
  });
}

async function applyResult(tx: Tx, idempotencyKey: string, result: OperationResult, onSettled: SettledHook) {
  const op = await tx.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey } });
  if (op.status !== "PENDING") return op.status;
  if (result.status === "PENDING") {
    await tx.paymentOperation.update({ where: { id: op.id }, data: { externalRef: result.externalRef } });
    return "PENDING" as const;
  }
  const done = await tx.paymentOperation.updateMany({
    where: { id: op.id, status: "PENDING" },
    data: {
      status: result.status,
      externalRef: result.externalRef ?? op.externalRef,
      error: result.status === "FAILED" ? result.error : null,
      completedAt: new Date(),
    },
  });
  if (done.count !== 1) return op.status;

  if (result.status === "SUCCEEDED") {
    await moveAccount(tx, op.dealId, op.kind === "RELEASE" ? { released: op.amount } : { refunded: op.amount });
  }
  await recordAudit(tx, {
    actor: ACTOR,
    action: result.status === "SUCCEEDED" ? "payment.operation.succeeded" : "payment.operation.failed",
    entity: { type: "paymentOperation", id: op.idempotencyKey },
    scope: `deal:${op.dealId}`,
    after: { kind: op.kind, amount: op.amount, status: result.status, externalRef: result.externalRef ?? null },
  });
  const settled: SettledOperation = { ...op, status: result.status, externalRef: result.externalRef ?? op.externalRef };
  await onSettled(tx, settled);
  return result.status;
}

/** Суммы движений по счёту и пересчёт статуса. */
async function moveAccount(tx: Tx, dealId: string, delta: { deposited?: number; released?: number; refunded?: number }) {
  const account = await tx.escrowAccount.update({
    where: { dealId },
    data: {
      deposited: { increment: delta.deposited ?? 0 },
      released: { increment: delta.released ?? 0 },
      refunded: { increment: delta.refunded ?? 0 },
    },
    include: { deal: { select: { totalAmount: true } } },
  });
  const status = escrowStatusOf({ ...account, total: account.deal.totalAmount });
  if (status !== account.status) await tx.escrowAccount.update({ where: { dealId }, data: { status } });
}

/** Открывает счёт сделки у рельса (идемпотентно по сделке). Для manual счёта нет. */
export async function ensureEscrowAccount(dealId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId }, include: { escrow: true } });
  if (!deal || deal.paymentMode === "MANUAL") return null;
  if (deal.escrow) return deal.escrow;

  const rail = railFor(railModeOf(deal.paymentMode));
  const opened = await rail.openAccount({ dealId, dealNumber: deal.number, amount: deal.totalAmount, idempotencyKey: `open:${dealId}` });
  const created = await db.escrowAccount.createMany({
    data: [{ dealId, rail: deal.paymentMode, externalId: opened.externalId, requisites: opened.requisites }],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    await recordAudit(db, {
      actor: ACTOR,
      action: "payment.account.opened",
      entity: { type: "escrowAccount", id: opened.externalId },
      scope: `deal:${dealId}`,
      after: { rail: deal.paymentMode, externalId: opened.externalId },
    });
  }
  return db.escrowAccount.findUnique({ where: { dealId } });
}

export type WebhookOutcome = { duplicate: boolean; event: RailWebhookEvent; dealId: string | null };

/**
 * Входящий вебхук рельса: проверка подписи, запись BankWebhookEvent (уникальный externalEventId)
 * и обработка — в одной транзакции. Повторная доставка того же события ничего не меняет.
 * Ошибка обработки откатывает и запись события: банк доставит его снова.
 */
export async function receiveWebhook(
  mode: RailMode,
  input: { headers: Headers; rawBody: string },
  onSettled: SettledHook,
): Promise<WebhookOutcome> {
  const event = await railFor(mode).parseWebhook(input);
  const rail = paymentModeOf(mode);

  return transaction(async (tx) => {
    const account = await tx.escrowAccount.findFirst({ where: { externalId: event.externalId, rail } });
    if (account) await lockDeal(tx, account.dealId);

    const stored = await tx.bankWebhookEvent.createMany({
      data: [{ rail, externalEventId: event.eventId, payload: JSON.parse(input.rawBody) }],
      skipDuplicates: true,
    });
    if (stored.count === 0) return { duplicate: true, event, dealId: account?.dealId ?? null };

    if (!account) {
      await tx.bankWebhookEvent.update({
        where: { externalEventId: event.eventId },
        data: { processedAt: new Date(), error: ru.payments.errors.accountNotFound },
      });
      return { duplicate: false, event, dealId: null };
    }

    if (event.type === "DEPOSIT_RECEIVED") {
      await recordDeposit(tx, account.dealId, event, onSettled);
    } else {
      const op = await tx.paymentOperation.findFirst({
        where: { dealId: account.dealId, OR: [{ idempotencyKey: event.operationRef }, { externalRef: event.operationRef }] },
      });
      if (op) {
        const result: OperationResult =
          event.type === "OPERATION_FAILED"
            ? { status: "FAILED", externalRef: event.operationRef, error: ru.payments.errors.railUnavailable }
            : { status: "SUCCEEDED", externalRef: event.operationRef ?? op.externalRef ?? event.eventId };
        await applyResult(tx, op.idempotencyKey, result, onSettled);
      }
    }
    await tx.bankWebhookEvent.update({ where: { externalEventId: event.eventId }, data: { processedAt: new Date() } });
    return { duplicate: false, event, dealId: account.dealId };
  });
}

async function recordDeposit(tx: Tx, dealId: string, event: RailWebhookEvent, onSettled: SettledHook) {
  const idempotencyKey = `deposit:${event.eventId}`;
  const externalRef = event.operationRef ?? event.eventId;
  const op = await tx.paymentOperation.create({
    data: { dealId, kind: "DEPOSIT", amount: event.amount, status: "SUCCEEDED", idempotencyKey, externalRef, completedAt: event.occurredAt },
  });
  await moveAccount(tx, dealId, { deposited: event.amount });
  await recordAudit(tx, {
    actor: ACTOR,
    action: "payment.deposit.received",
    entity: { type: "paymentOperation", id: idempotencyKey },
    scope: `deal:${dealId}`,
    after: { amount: event.amount, externalRef },
  });
  await onSettled(tx, { ...op, status: "SUCCEEDED" });
}

/**
 * Сколько на счёте сделки ещё можно распределить: внесено − перечислено − возвращено − операции в пути
 * (RELEASE/REFUND в PENDING: банк их ещё не исполнил, но деньги уже обещаны). Без вычета в пути
 * расторжение вернуло бы заказчику сумму транша, который вот-вот уйдёт исполнителю.
 */
export async function escrowAvailable(tx: Tx, dealId: string): Promise<number> {
  const account = await tx.escrowAccount.findUnique({ where: { dealId } });
  if (!account) return 0;
  const inFlight = await tx.paymentOperation.aggregate({
    where: { dealId, status: "PENDING", kind: { in: ["RELEASE", "REFUND"] } },
    _sum: { amount: true },
  });
  return account.deposited - account.released - account.refunded - (inFlight._sum.amount ?? 0);
}

/** Этапы, транш по которым уже запрошен или выполнен (PENDING или SUCCEEDED): их больше нельзя присудить. */
export async function stagesWithTranche(tx: Tx, dealId: string): Promise<Set<string>> {
  const ops = await tx.paymentOperation.findMany({
    where: { dealId, kind: "RELEASE", status: { in: ["PENDING", "SUCCEEDED"] }, stageId: { not: null } },
    select: { stageId: true },
  });
  return new Set(ops.flatMap((o) => (o.stageId ? [o.stageId] : [])));
}

/** Внесено ли на счёт не меньше суммы договора. */
export async function isFullyFunded(tx: Tx, dealId: string, total: number): Promise<boolean> {
  const account = await tx.escrowAccount.findUnique({ where: { dealId } });
  return !!account && account.deposited >= total;
}

export function assertAmount(amount: number, max: number) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > max) fail.validation(ru.payments.errors.depositAmount);
}
