import type { PreContractFlow, RequestStatus } from "@/generated/prisma/enums";

/**
 * Сценарии до договора (ADR-005, docs/product/pre-contract-variants.md) — данными.
 * Таблица шагов — единственное место, где решено, что и в каком порядке делается в сценарии:
 * из неё выводятся и шкала шагов на экранах, и правила сервиса (нужен ли залог, выезд исполнителя, проект до договора).
 * Модуль без server-only: шкала шагов рисуется и на клиенте.
 */

export const PRE_CONTRACT_FLOWS = ["EXECUTOR_MEASURE", "PLATFORM_MEASURER", "CONTRACT_FIRST", "MEASURE_DEPOSIT", "SELF_MEASURE"] as const satisfies readonly PreContractFlow[];

/** Текущее поведение площадки и сценарий заявок, отправленных до появления настройки. */
export const DEFAULT_FLOW: PreContractFlow = "EXECUTOR_MEASURE";

export type FlowStep =
  | "request" // заявка
  | "requestWithSizes" // заявка с размерами заказчика (онлайн-замер)
  | "siteMeasure" // замер площадки
  | "offers" // предложения и выбор
  | "deposit" // залог за выезд
  | "measure" // замер исполнителем
  | "project" // утверждение проекта
  | "contract" // договор
  | "work"; // оплата, работа, сдача и приёмка в сделке

export const FLOW_STEPS = {
  EXECUTOR_MEASURE: ["request", "offers", "measure", "project", "contract", "work"],
  PLATFORM_MEASURER: ["request", "siteMeasure", "offers", "project", "contract", "work"],
  CONTRACT_FIRST: ["request", "offers", "contract", "project", "work"],
  MEASURE_DEPOSIT: ["request", "offers", "deposit", "measure", "project", "contract", "work"],
  SELF_MEASURE: ["requestWithSizes", "offers", "project", "contract", "work"],
} as const satisfies Record<PreContractFlow, readonly FlowStep[]>;

const has = (flow: PreContractFlow, step: FlowStep) => (FLOW_STEPS[flow] as readonly FlowStep[]).includes(step);
const before = (flow: PreContractFlow, a: FlowStep, b: FlowStep) => {
  const steps: readonly FlowStep[] = FLOW_STEPS[flow];
  return steps.includes(a) && steps.indexOf(a) < steps.indexOf(b);
};

/** Правила сценария, выведенные из таблицы шагов. */
export const flowRules = (flow: PreContractFlow) => ({
  /** Исполнитель выезжает на замер до договора. */
  executorVisit: has(flow, "measure"),
  /** Заказчик вносит залог за выезд напрямую исполнителю. */
  deposit: has(flow, "deposit"),
  /** Заявка открывается исполнителям после замера площадки. */
  siteMeasure: has(flow, "siteMeasure"),
  /** Заказчик сам снимает размеры в мастере. */
  selfMeasure: has(flow, "requestWithSizes"),
  /** Согласие на договор — только после утверждённого проекта. */
  projectBeforeContract: before(flow, "project", "contract"),
});

/**
 * Путь заявки до сделки (решение 2.2.9). «TZ» — единственный путь ТЗ: отклики и торг → акцепт цены → оферта.
 * Сценарии до договора (ADR-005) — только под флагом preContractFlows. Путь — снимок при отправке:
 * смена флага или настройки не меняет заявки, которые уже идут.
 */
export const TZ_PATH = "TZ";
export type RequestPath = typeof TZ_PATH | PreContractFlow;

/** Путь отправленной заявки: снимок сценария при отправке; без снимка — путь ТЗ. */
export function pathOf(r: { preContractFlow: PreContractFlow | null }): RequestPath {
  return r.preContractFlow ?? TZ_PATH;
}

/** Сценарий до договора заявки или null (путь ТЗ): шаги замера, залога и проекта есть только у сценария. */
export function flowOf(r: { preContractFlow: PreContractFlow | null }): PreContractFlow | null {
  return r.preContractFlow;
}

/** Факты заявки, по которым видно, на каком она шаге. */
export type FlowFacts = {
  status: RequestStatus;
  /** Замер выбранного исполнителя выполнен. */
  measurementDone: boolean;
  /** Исполнитель подтвердил получение залога. */
  depositConfirmed: boolean;
  /** Заказчик утвердил проект. */
  projectApproved: boolean;
};

/** Шаг после выбора отклика и до договора: первый невыполненный по порядку сценария. */
function preContractStep(flow: PreContractFlow, f: FlowFacts): FlowStep {
  const r = flowRules(flow);
  if (r.deposit && !f.depositConfirmed) return "deposit";
  if (r.executorVisit && !f.measurementDone) return "measure";
  if (r.projectBeforeContract && !f.projectApproved) return "project";
  return "contract";
}

/** Текущий шаг заявки по сценарию; null — заявка отменена. */
export function currentFlowStep(flow: PreContractFlow, f: FlowFacts): FlowStep | null {
  switch (f.status) {
    case "DRAFT":
      return FLOW_STEPS[flow][0];
    case "PLATFORM_MEASURING":
      return "siteMeasure";
    case "OPEN":
      return "offers";
    case "OFFER_CHOSEN":
    case "MEASURING":
      return preContractStep(flow, f);
    case "CONTRACTING":
      return "contract";
    case "CLOSED":
      return has(flow, "project") && !f.projectApproved && !flowRules(flow).projectBeforeContract ? "project" : "work";
    case "CANCELLED":
      return null;
  }
}

/** Допуск цены в сценарии «договор до замера»: проект фиксирует цену в пределах ±15 % от цены отклика. */
export const PRICE_TOLERANCE_PERCENT = 15;

export function toleranceRange(price: number): { min: number; max: number } {
  return {
    min: Math.ceil((price * (100 - PRICE_TOLERANCE_PERCENT)) / 100),
    max: Math.floor((price * (100 + PRICE_TOLERANCE_PERCENT)) / 100),
  };
}

export function withinTolerance(total: number, price: number): boolean {
  const { min, max } = toleranceRange(price);
  return total >= min && total <= max;
}

/** Залог за выезд по умолчанию (сценарий 4), ₸: засчитывается в первую оплату по договору на площадке. */
export const MEASURE_DEPOSIT_AMOUNT = 10_000;

/** Онлайн-замер готов: заказчик указал ширину, высоту и глубину и приложил хотя бы одно фото стены с рулеткой. */
export function selfMeasureComplete(d: { widthCm?: number; heightCm?: number; depthCm?: number }, photos: number): boolean {
  return Boolean(d.widthCm && d.heightCm && d.depthCm) && photos > 0;
}

/**
 * Суммы сценариев до договора (проект, допуск, плата за выезд) — в целых тенге (ADR-009, п. 1): они под флагом
 * и в деньги сделки не входят. Цена отклика и сделки — тиыны; на границе — целые тенге (тиыны отбрасываются).
 */
export function wholeKzt(tiyn: bigint): number {
  return Number(tiyn / 100n);
}
