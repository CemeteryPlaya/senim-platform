import type {
  DepositStatus,
  MeasurementStatus,
  OfferStatus,
  PreContractFlow,
  ProjectStatus,
  RequestStatus,
  SiteMeasurementStatus,
} from "@/generated/prisma/enums";
import { fail } from "@/platform/errors";

/**
 * Статусные машины заявки, отклика, замера и шагов до договора (ADR-003, ADR-005) — данными.
 * Сервис спрашивает у таблицы, куда ведёт действие, и делает условное обновление
 * `updateMany({ where: { id, status: from } })`: гонка даёт ровно один успех.
 * Правило с `flows` действует только в этих сценариях до договора; без `flows` — во всех.
 */

export type Who = "CLIENT" | "EXECUTOR" | "OPERATOR" | "MEASURER" | "SYSTEM";

export type Rule<S extends string, A extends string> = {
  action: A;
  from: readonly S[];
  to: S;
  who: readonly Who[];
  /** Условие, которое проверяет сервис (для чтения людьми и для журнала). */
  guard?: string;
  /** Только в этих сценариях до договора. */
  flows?: readonly PreContractFlow[];
};

export type Table<S extends string, A extends string> = readonly Rule<S, A>[];

/** Сценарии, где до договора исполнитель выезжает на замер (и возможен «замер без сделки»). */
const EXECUTOR_VISIT = ["EXECUTOR_MEASURE", "MEASURE_DEPOSIT"] as const satisfies readonly PreContractFlow[];
/** Сценарии, где после выбора отклика договор заключается без выезда исполнителя. */
const NO_VISIT = ["PLATFORM_MEASURER", "CONTRACT_FIRST", "SELF_MEASURE"] as const satisfies readonly PreContractFlow[];

export const REQUEST_TRANSITIONS = [
  {
    action: "publish",
    from: ["DRAFT"],
    to: "OPEN",
    who: ["CLIENT"],
    guard: "все экраны мастера сохранены; для DIRECT исполнитель подтверждён; в SELF_MEASURE — три размера и фото с рулеткой",
    flows: ["EXECUTOR_MEASURE", "CONTRACT_FIRST", "MEASURE_DEPOSIT", "SELF_MEASURE"],
  },
  {
    action: "publish",
    from: ["DRAFT"],
    to: "PLATFORM_MEASURING",
    who: ["CLIENT"],
    guard: "как выше; исполнители увидят заявку после замера площадки",
    flows: ["PLATFORM_MEASURER"],
  },
  { action: "siteMeasured", from: ["PLATFORM_MEASURING"], to: "OPEN", who: ["MEASURER"], guard: "замер назначен этому замерщику, размеры внесены", flows: ["PLATFORM_MEASURER"] },
  { action: "chooseOffer", from: ["OPEN"], to: "OFFER_CHOSEN", who: ["CLIENT"], guard: "отклик в статусе SENT" },
  {
    action: "scheduleMeasurement",
    from: ["OFFER_CHOSEN"],
    to: "MEASURING",
    who: ["EXECUTOR"],
    guard: "выбран отклик этого исполнителя; в MEASURE_DEPOSIT — залог подтверждён",
    flows: EXECUTOR_VISIT,
  },
  { action: "agreeToContract", from: ["MEASURING"], to: "CONTRACTING", who: ["CLIENT"], guard: "замер DONE, проект утверждён; создаётся сделка", flows: EXECUTOR_VISIT },
  {
    action: "agreeToContract",
    from: ["OFFER_CHOSEN"],
    to: "CONTRACTING",
    who: ["CLIENT"],
    guard: "PLATFORM_MEASURER и SELF_MEASURE — проект утверждён; CONTRACT_FIRST — цена отклика с допуском ±15 %",
    flows: NO_VISIT,
  },
  { action: "measurementNoDeal", from: ["MEASURING"], to: "OPEN", who: ["CLIENT", "EXECUTOR"], guard: "замер SCHEDULED или DONE", flows: EXECUTOR_VISIT },
  { action: "contractSigned", from: ["CONTRACTING"], to: "CLOSED", who: ["SYSTEM"], guard: "договор подписан обеими сторонами" },
  {
    action: "dealCancelled",
    from: ["CONTRACTING", "CLOSED"],
    to: "CANCELLED",
    who: ["SYSTEM"],
    guard: "сделку отменили до начала работ: до подписи договора (CONTRACTING) или в эскроу до пополнения счёта (CLOSED)",
  },
  { action: "cancel", from: ["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING"], to: "CANCELLED", who: ["CLIENT"] },
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

/** Проект по выбранному отклику — статус последней версии; NONE — версий нет. Новая версия — новая строка. */
export type ProjectState = "NONE" | ProjectStatus;
export const PROJECT_TRANSITIONS = [
  {
    action: "submit",
    from: ["NONE", "CHANGES_REQUESTED"],
    to: "SUBMITTED",
    who: ["EXECUTOR"],
    guard: "отклик этого исполнителя выбран, заявка на шаге проекта; в CONTRACT_FIRST — цена в допуске ±15 %",
  },
  { action: "approve", from: ["SUBMITTED"], to: "APPROVED", who: ["CLIENT"] },
  { action: "requestChanges", from: ["SUBMITTED"], to: "CHANGES_REQUESTED", who: ["CLIENT"], guard: "комментарий заказчика" },
] as const satisfies Table<ProjectState, string>;

/** Залог за выезд (MEASURE_DEPOSIT): только отметки сторон, деньги идут напрямую исполнителю. */
export type DepositState = "NONE" | DepositStatus;
export const DEPOSIT_TRANSITIONS = [
  { action: "markPaid", from: ["NONE"], to: "MARKED_PAID", who: ["CLIENT"], guard: "отклик выбран, заявка OFFER_CHOSEN", flows: ["MEASURE_DEPOSIT"] },
  { action: "confirm", from: ["MARKED_PAID"], to: "CONFIRMED", who: ["EXECUTOR"], guard: "выбран отклик этого исполнителя", flows: ["MEASURE_DEPOSIT"] },
] as const satisfies Table<DepositState, string>;

/** Замер площадки (PLATFORM_MEASURER). */
export type SiteMeasurementState = "NONE" | SiteMeasurementStatus;
export const SITE_MEASUREMENT_TRANSITIONS = [
  {
    action: "assign",
    from: ["NONE"],
    to: "ASSIGNED",
    who: ["OPERATOR"],
    guard: "заявка PLATFORM_MEASURING; замерщик — не сторона заявки",
    flows: ["PLATFORM_MEASURER"],
  },
  { action: "complete", from: ["ASSIGNED"], to: "DONE", who: ["MEASURER"], guard: "назначен этот замерщик, размеры внесены", flows: ["PLATFORM_MEASURER"] },
] as const satisfies Table<SiteMeasurementState, string>;

export type RequestAction = (typeof REQUEST_TRANSITIONS)[number]["action"];
export type OfferAction = (typeof OFFER_TRANSITIONS)[number]["action"];
export type MeasurementAction = (typeof MEASUREMENT_TRANSITIONS)[number]["action"];

/**
 * Куда ведёт действие из текущего статуса в сценарии `flow`. Неверный статус или сценарий — CONFLICT
 * (состояние уже изменилось: повтор или гонка; или шаг не из этого сценария), чужая роль — FORBIDDEN.
 */
export function transition<S extends string, A extends string>(table: Table<S, A>, action: A, from: S, who: Who, flow?: PreContractFlow): S {
  const rules = table.filter((r) => r.action === action);
  if (!rules.some((r) => r.who.includes(who))) return fail.forbidden();
  const inFlow = (r: Rule<S, A>) => !r.flows || (flow !== undefined && r.flows.includes(flow));
  const rule = rules.find((r) => r.who.includes(who) && r.from.includes(from) && inFlow(r));
  if (!rule) return fail.conflict();
  return rule.to;
}

/** Статус для записи в БД: таблицы шагов до договора никогда не ведут в NONE («записи ещё нет»). */
export function stored<S extends string>(state: S | "NONE"): S {
  if (state === "NONE") throw new Error("Переход не может вести в NONE");
  return state;
}
