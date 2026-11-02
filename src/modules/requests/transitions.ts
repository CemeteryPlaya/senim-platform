import type {
  DepositStatus,
  MeasurementStatus,
  OfferStatus,
  PreContractFlow,
  ProjectStatus,
  ProposalStatus,
  RequestStatus,
  SiteMeasurementStatus,
} from "@/generated/prisma/enums";
import { fail } from "@/platform/errors";
import type { RequestPath } from "./flows";

/**
 * Статусные машины заявки, отклика, торга, замера и шагов до договора (ADR-003, ADR-005, ADR-009) — данными.
 * Сервис спрашивает у таблицы, куда ведёт действие, и делает условное обновление
 * `updateMany({ where: { id, status: from } })`: гонка даёт ровно один успех.
 * Правило с `flows` действует только на этих путях заявки (путь ТЗ или сценарий до договора); без `flows` — на всех.
 */

export type Who = "CLIENT" | "EXECUTOR" | "OPERATOR" | "MEASURER" | "SYSTEM";

export type Rule<S extends string, A extends string, W extends string = Who> = {
  action: A;
  from: readonly S[];
  to: S;
  who: readonly W[];
  /** Условие, которое проверяет сервис (для чтения людьми и для журнала). */
  guard?: string;
  /** Только на этих путях заявки. */
  flows?: readonly RequestPath[];
};

export type Table<S extends string, A extends string, W extends string = Who> = readonly Rule<S, A, W>[];

/** Сценарии, где до договора исполнитель выезжает на замер (и возможен «замер без сделки»). */
const EXECUTOR_VISIT = ["EXECUTOR_MEASURE", "MEASURE_DEPOSIT"] as const satisfies readonly PreContractFlow[];
/** Сценарии, где после выбора отклика договор заключается без выезда исполнителя. */
const NO_VISIT = ["PLATFORM_MEASURER", "CONTRACT_FIRST", "SELF_MEASURE"] as const satisfies readonly PreContractFlow[];
/** Все сценарии до договора (флаг preContractFlows): там заказчик сначала выбирает отклик, цена — после замера или проекта. */
const PRE_CONTRACT = [...EXECUTOR_VISIT, ...NO_VISIT] as const satisfies readonly PreContractFlow[];

export const REQUEST_TRANSITIONS = [
  {
    action: "publish",
    from: ["DRAFT"],
    to: "OPEN",
    who: ["CLIENT"],
    guard: "все экраны мастера сохранены; для DIRECT исполнитель подтверждён; в SELF_MEASURE — три размера и фото с рулеткой",
    flows: ["TZ", "EXECUTOR_MEASURE", "CONTRACT_FIRST", "MEASURE_DEPOSIT", "SELF_MEASURE"],
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
  {
    action: "priceAccepted",
    from: ["OPEN"],
    to: "CONTRACTING",
    who: ["CLIENT", "EXECUTOR"],
    guard: "сторона отклика приняла открытую цену другой стороны; в той же транзакции создаётся сделка с офертой",
    flows: ["TZ"],
  },
  { action: "chooseOffer", from: ["OPEN"], to: "OFFER_CHOSEN", who: ["CLIENT"], guard: "отклик в статусе SENT", flows: PRE_CONTRACT },
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
  { action: "contractSigned", from: ["CONTRACTING"], to: "CLOSED", who: ["SYSTEM"], guard: "оферта подписана обеими сторонами" },
  {
    action: "dealCancelled",
    from: ["CONTRACTING", "CLOSED"],
    to: "CANCELLED",
    who: ["SYSTEM"],
    guard: "сделку отменили до начала работ: до подписи оферты (CONTRACTING) или после подписи до начала работ (CLOSED)",
  },
  { action: "cancel", from: ["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING"], to: "CANCELLED", who: ["CLIENT"] },
] as const satisfies Table<RequestStatus, string>;

export const OFFER_TRANSITIONS = [
  { action: "withdraw", from: ["SENT"], to: "WITHDRAWN", who: ["EXECUTOR"], guard: "заявка ещё OPEN" },
  { action: "accept", from: ["SENT"], to: "ACCEPTED", who: ["CLIENT"], guard: "выбор отклика в сценарии до договора" },
  { action: "priceAccepted", from: ["SENT"], to: "ACCEPTED", who: ["CLIENT", "EXECUTOR"], guard: "принята цена торга по этому отклику" },
  { action: "decline", from: ["SENT"], to: "DECLINED", who: ["CLIENT"], guard: "выбран другой отклик или заявка отменена" },
  { action: "closedForOthers", from: ["SENT"], to: "DECLINED", who: ["SYSTEM"], guard: "по заявке принята цена другого отклика" },
  { action: "noDeal", from: ["ACCEPTED"], to: "DECLINED", who: ["CLIENT", "EXECUTOR"], guard: "замер без сделки" },
  { action: "requestCancelled", from: ["ACCEPTED"], to: "DECLINED", who: ["CLIENT"], guard: "заказчик отменил заявку до договора" },
] as const satisfies Table<OfferStatus, string>;

/**
 * Торг по отклику (решение 2.2.3, ТЗ п. 9): раунды PriceProposal. Роль — относительно открытого (PROPOSED) предложения:
 * AUTHOR — его автор, OTHER — другая сторона отклика; при NONE (открытого нет) действующий становится автором.
 * Встречная цена — counter (прежнее SUPERSEDED) и новое PROPOSED в той же транзакции. Открытое — одно на отклик
 * (частичный уникальный индекс PriceProposal_one_open_per_offer).
 */
export type ProposalState = "NONE" | ProposalStatus;
export type ProposalWho = "AUTHOR" | "OTHER";
export const PROPOSAL_TRANSITIONS = [
  { action: "propose", from: ["NONE"], to: "PROPOSED", who: ["AUTHOR"], guard: "отклик SENT, заявка OPEN на пути ТЗ; открытого предложения нет" },
  { action: "counter", from: ["PROPOSED"], to: "SUPERSEDED", who: ["OTHER"], guard: "встречная цена: в той же транзакции новое PROPOSED" },
  { action: "withdraw", from: ["PROPOSED"], to: "WITHDRAWN", who: ["AUTHOR"] },
  { action: "accept", from: ["PROPOSED"], to: "ACCEPTED", who: ["OTHER"], guard: "фиксирует цену X; сделка (оферта) создаётся в той же транзакции" },
] as const satisfies Table<ProposalState, string, ProposalWho>;

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
export type ProposalAction = (typeof PROPOSAL_TRANSITIONS)[number]["action"];

/**
 * Куда ведёт действие из текущего статуса на пути заявки `path`. Неверный статус или путь — CONFLICT
 * (состояние уже изменилось: повтор или гонка; или шаг не с этого пути), чужая роль — FORBIDDEN.
 */
export function transition<S extends string, A extends string, W extends string>(
  table: Table<S, A, W>,
  action: A,
  from: S,
  who: W,
  path?: RequestPath,
  message?: string,
): S {
  const rules = table.filter((r) => r.action === action);
  if (!rules.some((r) => r.who.includes(who))) return fail.forbidden(message);
  const inPath = (r: Rule<S, A, W>) => !r.flows || (path !== undefined && r.flows.includes(path));
  const rule = rules.find((r) => r.who.includes(who) && r.from.includes(from) && inPath(r));
  if (!rule) return fail.conflict();
  return rule.to;
}

/** Статус для записи в БД: таблицы шагов до договора никогда не ведут в NONE («записи ещё нет»). */
export function stored<S extends string>(state: S | "NONE"): S {
  if (state === "NONE") throw new Error("Переход не может вести в NONE");
  return state;
}
