import { ru } from "@/i18n/ru";
import { logger } from "@/platform/logger";
import type { ProviderResult } from "../../provider";
import type { ApiOutcome } from "./client";
import type { Fields } from "./signature";
import { fieldGroup, fieldText } from "./xml";

/**
 * Ссылки на операции Freedom Pay в журнале (`externalRef`) и перевод статусов документации в ProviderResult.
 * Ссылка несёт вид операции — getStatus знает, какой метод спрашивать, без догадок по ключу.
 */

export type Ref =
  | { kind: "payment"; paymentId: string }
  | { kind: "capture"; paymentId: string }
  | { kind: "cancel"; paymentId: string; operationId: string }
  | { kind: "refund"; paymentId: string; operationId: string }
  | { kind: "payout"; payoutId: string }
  /** Доход платформы: перевода нет, сумма уже на балансе мерчанта (см. index.ts, split). */
  | { kind: "retained"; key: string }
  /** Остаток двухстадийной оплаты разблокирован частичным клирингом — отдельного возврата нет. */
  | { kind: "released"; paymentId: string };

export function formatRef(ref: Ref): string {
  switch (ref.kind) {
    case "payment":
    case "capture":
    case "released":
      return `${ref.kind}:${ref.paymentId}`;
    case "cancel":
    case "refund":
      return `${ref.kind}:${ref.paymentId}:${ref.operationId}`;
    case "payout":
      return `payout:${ref.payoutId}`;
    case "retained":
      return `retained:${ref.key}`;
  }
}

export function parseRef(text: string): Ref | null {
  const retained = /^retained:(.+)$/.exec(text);
  if (retained) return { kind: "retained", key: retained[1]! };
  const payment = /^(payment|capture|released):(\d+)$/.exec(text);
  if (payment) return { kind: payment[1] as "payment" | "capture" | "released", paymentId: payment[2]! };
  const payout = /^payout:(\d+)$/.exec(text);
  if (payout) return { kind: "payout", payoutId: payout[1]! };
  const pair = /^(cancel|refund):(\d+):(\d+)$/.exec(text);
  if (pair) return { kind: pair[1] as "cancel" | "refund", paymentId: pair[2]!, operationId: pair[3]! };
  return null;
}

export const declinedText = (code: string, description: string) => ru.payments.freedompay.declined(code, description);

/** Отказ или неизвестный исход вызова → ProviderResult; неизвестный исход — PENDING: итог уточнит getStatus. */
export function notOk(outcome: Exclude<ApiOutcome, { kind: "ok" }>, externalRef?: string): ProviderResult {
  if (outcome.kind === "declined") return { status: "FAILED", error: declinedText(outcome.code, outcome.description) };
  return externalRef ? { status: "PENDING", externalRef } : { status: "PENDING" };
}

const failure = (fields: Fields) => declinedText(fieldText(fields, "pg_failure_code") ?? "", fieldText(fields, "pg_failure_description") ?? "");

/**
 * Статус операции по документации: платёж (get_status3.php) — new, waiting, process, success, error;
 * выплата (payment_status2) — new, process, success, error; элементы списков возвратов — success, process, error.
 * Других значений документация не описывает. Незнакомый статус — не отказ банка: PENDING (операция остаётся
 * ждущей, итог уточнит следующий опрос или уведомление) и предупреждение в журнал — разбирает оператор.
 */
export function statusResult(paymentStatus: string | undefined, fields: Fields, externalRef: string): ProviderResult {
  switch (paymentStatus) {
    case "success":
      return { status: "SUCCEEDED", externalRef };
    case "error":
      return { status: "FAILED", error: failure(fields) };
    case "new":
    case "waiting":
    case "process":
      return { status: "PENDING", externalRef };
    default:
      logger.warn("freedompay: статус вне документации — операция остаётся ждущей", { paymentStatus: paymentStatus ?? null, externalRef });
      return { status: "PENDING", externalRef };
  }
}

/** Возврат или отмена в ответе get_status3.php: `pg_refund_payments` / `pg_revoked_payments` → элемент по id. */
export function operationResult(fields: Fields, ref: Extract<Ref, { kind: "cancel" | "refund" }>): ProviderResult {
  const [group, item] = ref.kind === "refund" ? ["pg_refund_payments", "pg_refund_payment"] : ["pg_revoked_payments", "pg_revoked_payment"];
  const entry = (fieldGroup(fields, group) ?? [])
    .filter(([name, value]) => name === item && typeof value !== "string")
    .map(([, value]) => value as Fields)
    .find((op) => fieldText(op, "pg_payment_id") === ref.operationId);
  const externalRef = formatRef(ref);
  // Операция подтверждена синхронно, а в списке её ещё нет — ждём, не закрываем.
  if (!entry) return { status: "PENDING", externalRef };
  return statusResult(fieldText(entry, "pg_payment_status"), entry, externalRef);
}
