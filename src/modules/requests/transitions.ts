import type { MeasurementStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import { fail } from "@/platform/errors";

/**
 * Статусные машины заявки, отклика и замера (ADR-003) — данными.
 * Сервис спрашивает у таблицы, куда ведёт действие, и делает условное обновление
 * `updateMany({ where: { id, status: from } })`: гонка даёт ровно один успех.
 */

export type Who = "CLIENT" | "EXECUTOR" | "OPERATOR" | "SYSTEM";

export type Rule<S extends string, A extends string> = {
  action: A;
  from: readonly S[];
  to: S;
  who: readonly Who[];
  /** Условие, которое проверяет сервис (для чтения людьми и для журнала). */
  guard?: string;
};

export type Table<S extends string, A extends string> = readonly Rule<S, A>[];

export const REQUEST_TRANSITIONS = [
  { action: "publish", from: ["DRAFT"], to: "OPEN", who: ["CLIENT"], guard: "все экраны мастера сохранены; для DIRECT исполнитель подтверждён" },
  { action: "chooseOffer", from: ["OPEN"], to: "OFFER_CHOSEN", who: ["CLIENT"], guard: "отклик в статусе SENT" },
  { action: "scheduleMeasurement", from: ["OFFER_CHOSEN"], to: "MEASURING", who: ["EXECUTOR"], guard: "выбран отклик этого исполнителя" },
  { action: "agreeToContract", from: ["MEASURING"], to: "CONTRACTING", who: ["CLIENT"], guard: "замер DONE с итоговой ценой; создаётся сделка" },
  { action: "measurementNoDeal", from: ["MEASURING"], to: "OPEN", who: ["CLIENT", "EXECUTOR"], guard: "замер SCHEDULED или DONE" },
  { action: "contractSigned", from: ["CONTRACTING"], to: "CLOSED", who: ["SYSTEM"], guard: "договор подписан обеими сторонами" },
  { action: "dealCancelled", from: ["CONTRACTING"], to: "CANCELLED", who: ["SYSTEM"], guard: "сделку отменили до начала работ" },
  { action: "cancel", from: ["DRAFT", "OPEN", "OFFER_CHOSEN", "MEASURING"], to: "CANCELLED", who: ["CLIENT"] },
] as const satisfies Table<RequestStatus, string>;

export const OFFER_TRANSITIONS = [
  { action: "withdraw", from: ["SENT"], to: "WITHDRAWN", who: ["EXECUTOR"], guard: "заявка ещё OPEN" },
  { action: "accept", from: ["SENT"], to: "ACCEPTED", who: ["CLIENT"] },
  { action: "decline", from: ["SENT"], to: "DECLINED", who: ["CLIENT"], guard: "выбран другой отклик или заявка отменена" },
  { action: "noDeal", from: ["ACCEPTED"], to: "DECLINED", who: ["CLIENT", "EXECUTOR"], guard: "замер без сделки" },
  { action: "requestCancelled", from: ["ACCEPTED"], to: "DECLINED", who: ["CLIENT"], guard: "заказчик отменил заявку до договора" },
] as const satisfies Table<OfferStatus, string>;

export const MEASUREMENT_TRANSITIONS = [
  { action: "complete", from: ["SCHEDULED"], to: "DONE", who: ["EXECUTOR"], guard: "итоговая цена указана" },
  { action: "noDeal", from: ["SCHEDULED", "DONE"], to: "NO_DEAL", who: ["CLIENT", "EXECUTOR"], guard: "плата за выезд — только запись feeAccrued" },
  { action: "cancel", from: ["SCHEDULED"], to: "CANCELLED", who: ["CLIENT"], guard: "заказчик отменил заявку до выезда" },
] as const satisfies Table<MeasurementStatus, string>;

export type RequestAction = (typeof REQUEST_TRANSITIONS)[number]["action"];
export type OfferAction = (typeof OFFER_TRANSITIONS)[number]["action"];
export type MeasurementAction = (typeof MEASUREMENT_TRANSITIONS)[number]["action"];

/**
 * Куда ведёт действие из текущего статуса. Неверный статус — CONFLICT
 * (состояние уже изменилось: повтор или гонка), чужая роль — FORBIDDEN.
 */
export function transition<S extends string, A extends string>(table: Table<S, A>, action: A, from: S, who: Who): S {
  const rules = table.filter((r) => r.action === action);
  if (!rules.some((r) => r.who.includes(who))) return fail.forbidden();
  const rule = rules.find((r) => r.who.includes(who) && r.from.includes(from));
  if (!rule) return fail.conflict();
  return rule.to;
}
