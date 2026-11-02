import { describe, expect, it } from "vitest";
import { isAppError } from "@/platform/errors";
import { PRE_CONTRACT_FLOWS, TZ_PATH, type RequestPath } from "./flows";
import {
  PROPOSAL_TRANSITIONS,
  DEPOSIT_TRANSITIONS,
  MEASUREMENT_TRANSITIONS,
  OFFER_TRANSITIONS,
  PROJECT_TRANSITIONS,
  REQUEST_TRANSITIONS,
  SITE_MEASUREMENT_TRANSITIONS,
  transition,
  type Table,
  type Who,
} from "./transitions";

const WHO: Who[] = ["CLIENT", "EXECUTOR", "OPERATOR", "MEASURER", "SYSTEM"];
const REQUEST_STATUSES = ["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"] as const;
const OFFER_STATUSES = ["SENT", "WITHDRAWN", "DECLINED", "ACCEPTED"] as const;
const MEASUREMENT_STATUSES = ["SCHEDULED", "DONE", "NO_DEAL", "CANCELLED"] as const;
const PROJECT_STATES = ["NONE", "SUBMITTED", "APPROVED", "CHANGES_REQUESTED"] as const;
const DEPOSIT_STATES = ["NONE", "MARKED_PAID", "CONFIRMED"] as const;
const SITE_STATES = ["NONE", "ASSIGNED", "DONE"] as const;

/** Спецификация ADR-003 и ADR-005, записанная независимо от таблиц: «действие: из → в (кто)» для каждого сценария. */
const REQUEST_COMMON = [
  "contractSigned: CONTRACTING → CLOSED (SYSTEM)",
  "dealCancelled: CONTRACTING → CANCELLED (SYSTEM)",
  "dealCancelled: CLOSED → CANCELLED (SYSTEM)",
  "cancel: DRAFT → CANCELLED (CLIENT)",
  "cancel: PLATFORM_MEASURING → CANCELLED (CLIENT)",
  "cancel: OPEN → CANCELLED (CLIENT)",
  "cancel: OFFER_CHOSEN → CANCELLED (CLIENT)",
  "cancel: MEASURING → CANCELLED (CLIENT)",
];
/** Путь ТЗ (решение 2.2.9): торг в отклике, акцепт цены любой стороной сразу порождает оферту. */
const TZ_SPEC = [
  ...REQUEST_COMMON,
  "publish: DRAFT → OPEN (CLIENT)",
  "priceAccepted: OPEN → CONTRACTING (CLIENT)",
  "priceAccepted: OPEN → CONTRACTING (EXECUTOR)",
];
/** Сценарии до договора (флаг preContractFlows): заказчик выбирает отклик, цена — после замера или проекта. */
const PRE_COMMON = [...REQUEST_COMMON, "chooseOffer: OPEN → OFFER_CHOSEN (CLIENT)"];
/** Выезд исполнителя до договора: сценарии 1 и 4. */
const EXECUTOR_VISIT = [
  "publish: DRAFT → OPEN (CLIENT)",
  "scheduleMeasurement: OFFER_CHOSEN → MEASURING (EXECUTOR)",
  "agreeToContract: MEASURING → CONTRACTING (CLIENT)",
  "measurementNoDeal: MEASURING → OPEN (CLIENT)",
  "measurementNoDeal: MEASURING → OPEN (EXECUTOR)",
];
const REQUEST_SPEC: Record<RequestPath, string[]> = {
  TZ: TZ_SPEC,
  EXECUTOR_MEASURE: [...PRE_COMMON, ...EXECUTOR_VISIT],
  MEASURE_DEPOSIT: [...PRE_COMMON, ...EXECUTOR_VISIT],
  PLATFORM_MEASURER: [
    ...PRE_COMMON,
    "publish: DRAFT → PLATFORM_MEASURING (CLIENT)",
    "siteMeasured: PLATFORM_MEASURING → OPEN (MEASURER)",
    "agreeToContract: OFFER_CHOSEN → CONTRACTING (CLIENT)",
  ],
  CONTRACT_FIRST: [...PRE_COMMON, "publish: DRAFT → OPEN (CLIENT)", "agreeToContract: OFFER_CHOSEN → CONTRACTING (CLIENT)"],
  SELF_MEASURE: [...PRE_COMMON, "publish: DRAFT → OPEN (CLIENT)", "agreeToContract: OFFER_CHOSEN → CONTRACTING (CLIENT)"],
};

const OFFER_SPEC = [
  "withdraw: SENT → WITHDRAWN (EXECUTOR)",
  "accept: SENT → ACCEPTED (CLIENT)",
  "priceAccepted: SENT → ACCEPTED (CLIENT)",
  "priceAccepted: SENT → ACCEPTED (EXECUTOR)",
  "decline: SENT → DECLINED (CLIENT)",
  "closedForOthers: SENT → DECLINED (SYSTEM)",
  "noDeal: ACCEPTED → DECLINED (CLIENT)",
  "noDeal: ACCEPTED → DECLINED (EXECUTOR)",
  "requestCancelled: ACCEPTED → DECLINED (CLIENT)",
];

const MEASUREMENT_SPEC = [
  "complete: SCHEDULED → DONE (EXECUTOR)",
  "noDeal: SCHEDULED → NO_DEAL (CLIENT)",
  "noDeal: SCHEDULED → NO_DEAL (EXECUTOR)",
  "noDeal: DONE → NO_DEAL (CLIENT)",
  "noDeal: DONE → NO_DEAL (EXECUTOR)",
  "cancel: SCHEDULED → CANCELLED (CLIENT)",
];

/** Торг (решение 2.2.3): роль — относительно открытого предложения; для «нет предложения» действующий станет автором. */
const PROPOSAL_STATES = ["NONE", "PROPOSED", "SUPERSEDED", "WITHDRAWN", "ACCEPTED"] as const;
const PROPOSAL_SPEC = [
  "propose: NONE → PROPOSED (AUTHOR)",
  "counter: PROPOSED → SUPERSEDED (OTHER)",
  "withdraw: PROPOSED → WITHDRAWN (AUTHOR)",
  "accept: PROPOSED → ACCEPTED (OTHER)",
];

const PROJECT_SPEC = [
  "submit: NONE → SUBMITTED (EXECUTOR)",
  "submit: CHANGES_REQUESTED → SUBMITTED (EXECUTOR)",
  "approve: SUBMITTED → APPROVED (CLIENT)",
  "requestChanges: SUBMITTED → CHANGES_REQUESTED (CLIENT)",
];

function allowedCombos<S extends string, A extends string, W extends string = Who>(
  table: Table<S, A, W>,
  statuses: readonly S[],
  flow?: RequestPath,
  who: readonly W[] = WHO as unknown as readonly W[],
): string[] {
  const actions = [...new Set(table.map((r) => r.action))];
  const out: string[] = [];
  for (const action of actions)
    for (const from of statuses)
      for (const w of who) {
        try {
          out.push(`${action}: ${from} → ${transition(table, action, from, w, flow)} (${w})`);
        } catch (e) {
          if (!isAppError(e)) throw e;
        }
      }
  return out;
}

describe("таблицы переходов", () => {
  it.each<RequestPath>([TZ_PATH, ...PRE_CONTRACT_FLOWS])("заявка, путь %s: разрешены ровно переходы из спецификации", (flow) => {
    expect(allowedCombos(REQUEST_TRANSITIONS as Table<string, string>, REQUEST_STATUSES, flow).sort()).toEqual([...REQUEST_SPEC[flow]].sort());
  });

  it.each(PRE_CONTRACT_FLOWS)("проект, сценарий %s: одинаково во всех сценариях", (flow) => {
    expect(allowedCombos(PROJECT_TRANSITIONS as Table<string, string>, PROJECT_STATES, flow).sort()).toEqual([...PROJECT_SPEC].sort());
  });

  it.each([
    ["отклик", OFFER_TRANSITIONS, OFFER_STATUSES, OFFER_SPEC],
    ["замер", MEASUREMENT_TRANSITIONS, MEASUREMENT_STATUSES, MEASUREMENT_SPEC],
  ] as const)("%s: разрешены ровно переходы из спецификации, все остальные запрещены", (_name, table, statuses, spec) => {
    expect(allowedCombos(table as Table<string, string>, statuses).sort()).toEqual([...spec].sort());
  });

  it("предложение цены: встречная, отзыв и акцепт — по роли относительно открытого предложения; чужое принять нельзя", () => {
    expect(allowedCombos(PROPOSAL_TRANSITIONS, PROPOSAL_STATES, undefined, ["AUTHOR", "OTHER"] as const).sort()).toEqual([...PROPOSAL_SPEC].sort());
    expect(() => transition(PROPOSAL_TRANSITIONS, "accept", "PROPOSED", "AUTHOR")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => transition(PROPOSAL_TRANSITIONS, "accept", "SUPERSEDED", "OTHER")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });

  it("залог — только в сценарии 4: отметка заказчика, затем подтверждение исполнителя", () => {
    for (const flow of PRE_CONTRACT_FLOWS) {
      const expected = flow === "MEASURE_DEPOSIT" ? ["markPaid: NONE → MARKED_PAID (CLIENT)", "confirm: MARKED_PAID → CONFIRMED (EXECUTOR)"] : [];
      expect(allowedCombos(DEPOSIT_TRANSITIONS as Table<string, string>, DEPOSIT_STATES, flow).sort()).toEqual(expected.sort());
    }
  });

  it("замер площадки — только в сценарии 2: оператор назначает, замерщик выполняет", () => {
    for (const flow of PRE_CONTRACT_FLOWS) {
      const expected = flow === "PLATFORM_MEASURER" ? ["assign: NONE → ASSIGNED (OPERATOR)", "complete: ASSIGNED → DONE (MEASURER)"] : [];
      expect(allowedCombos(SITE_MEASUREMENT_TRANSITIONS as Table<string, string>, SITE_STATES, flow).sort()).toEqual(expected.sort());
    }
  });

  it("неверный статус — конфликт (данные уже изменились), чужая роль — нет прав", () => {
    expect(() => transition(REQUEST_TRANSITIONS, "chooseOffer", "OFFER_CHOSEN", "CLIENT", "EXECUTOR_MEASURE")).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => transition(REQUEST_TRANSITIONS, "chooseOffer", "OPEN", "EXECUTOR")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("шаг не из сценария заявки — конфликт, а не «нет прав»", () => {
    expect(() => transition(REQUEST_TRANSITIONS, "scheduleMeasurement", "OFFER_CHOSEN", "EXECUTOR", "SELF_MEASURE")).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => transition(REQUEST_TRANSITIONS, "publish", "DRAFT", "CLIENT")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    // Выбор отклика без торга и цена из торга — каждое только на своём пути.
    expect(() => transition(REQUEST_TRANSITIONS, "chooseOffer", "OPEN", "CLIENT", TZ_PATH)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
    expect(() => transition(REQUEST_TRANSITIONS, "priceAccepted", "OPEN", "CLIENT", "EXECUTOR_MEASURE")).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  });
});
