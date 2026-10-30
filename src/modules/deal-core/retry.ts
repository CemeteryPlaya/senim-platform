import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { escrowAvailable } from "@/modules/payments";
import { transaction } from "@/platform/db";
import { fail } from "@/platform/errors";
import { requestMoney } from "./effects";
import { parseInput, retryOperationSchema } from "./schemas";
import { settleDeal } from "./service";
import { lockDeal, scopeOf } from "./state";

/**
 * Повтор отклонённой банком операции (ADR-002, «Зависшие и отклонённые операции»).
 * Ключ идемпотентности нельзя переиспользовать: банк вернёт по нему тот же отказ. Повтор — новая
 * операция с ключом <исходный>:retry:<n> (например, release:<stageId>:retry:1).
 * «Один транш на этап» сохраняется: в семействе ключей не больше одной операции в пути или выполненной —
 * повтор запрещён, пока есть PENDING или SUCCEEDED. Всё под блокировкой сделки: двойной клик — один повтор.
 */
const RETRY_SUFFIX = /:retry:\d+$/;

export async function retryPaymentOperation(operator: CurrentUser, raw: { idempotencyKey: string }): Promise<{ idempotencyKey: string }> {
  if (operator.role !== "OPERATOR") return fail.forbidden();
  const input = parseInput(retryOperationSchema, raw);

  const result = await transaction(async (tx) => {
    const ref = await tx.paymentOperation.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { dealId: true } });
    if (!ref) return fail.notFound(ru.deal.errors.operationNotFound);
    await lockDeal(tx, ref.dealId);
    const op = await tx.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
    if (op.kind === "DEPOSIT" || op.status !== "FAILED") return fail.conflict(ru.deal.errors.retryOnlyFailed);

    const base = op.idempotencyKey.replace(RETRY_SUFFIX, "");
    const family = await tx.paymentOperation.findMany({
      where: { dealId: op.dealId, OR: [{ idempotencyKey: base }, { idempotencyKey: { startsWith: `${base}:retry:` } }] },
      select: { status: true },
    });
    if (family.some((o) => o.status !== "FAILED")) return fail.conflict(ru.deal.errors.retryInProgress);
    if (op.amount > (await escrowAvailable(tx, op.dealId))) return fail.conflict(ru.deal.errors.retryNoFunds);

    const idempotencyKey = `${base}:retry:${family.length}`;
    await requestMoney(tx, { dealId: op.dealId, stageId: op.stageId ?? undefined, kind: op.kind, amount: op.amount, idempotencyKey });
    await recordAudit(tx, {
      actor: actorOf(operator),
      action: "payment.operation.retried",
      entity: { type: "paymentOperation", id: idempotencyKey },
      scope: scopeOf(op.dealId),
      before: { idempotencyKey: op.idempotencyKey, status: op.status, error: op.error },
      after: { idempotencyKey, kind: op.kind, amount: op.amount },
    });
    return { dealId: op.dealId, idempotencyKey };
  });

  await settleDeal(result.dealId);
  return { idempotencyKey: result.idempotencyKey };
}
