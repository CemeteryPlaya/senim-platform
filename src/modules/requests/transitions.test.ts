import { describe, expect, it } from "vitest";
import { isAppError } from "@/platform/errors";
import { MEASUREMENT_TRANSITIONS, OFFER_TRANSITIONS, REQUEST_TRANSITIONS, transition, type Table, type Who } from "./transitions";

const WHO: Who[] = ["CLIENT", "EXECUTOR", "OPERATOR", "SYSTEM"];
const REQUEST_STATUSES = ["DRAFT", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"] as const;
const OFFER_STATUSES = ["SENT", "WITHDRAWN", "DECLINED", "ACCEPTED"] as const;
const MEASUREMENT_STATUSES = ["SCHEDULED", "DONE", "NO_DEAL", "CANCELLED"] as const;

/** Спецификация ADR-003, записанная независимо от таблиц: «действие: из → в (кто)». */
const REQUEST_SPEC = [
  "publish: DRAFT → OPEN (CLIENT)",
  "chooseOffer: OPEN → OFFER_CHOSEN (CLIENT)",
  "scheduleMeasurement: OFFER_CHOSEN → MEASURING (EXECUTOR)",
  "agreeToContract: MEASURING → CONTRACTING (CLIENT)",
  "measurementNoDeal: MEASURING → OPEN (CLIENT)",
  "measurementNoDeal: MEASURING → OPEN (EXECUTOR)",
  "contractSigned: CONTRACTING → CLOSED (SYSTEM)",
  "dealCancelled: CONTRACTING → CANCELLED (SYSTEM)",
  "dealCancelled: CLOSED → CANCELLED (SYSTEM)",
  "cancel: DRAFT → CANCELLED (CLIENT)",
  "cancel: OPEN → CANCELLED (CLIENT)",
  "cancel: OFFER_CHOSEN → CANCELLED (CLIENT)",
  "cancel: MEASURING → CANCELLED (CLIENT)",
];

const OFFER_SPEC = [
  "withdraw: SENT → WITHDRAWN (EXECUTOR)",
  "accept: SENT → ACCEPTED (CLIENT)",
  "decline: SENT → DECLINED (CLIENT)",
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

function allowedCombos<S extends string, A extends string>(table: Table<S, A>, statuses: readonly S[]): string[] {
  const actions = [...new Set(table.map((r) => r.action))];
  const out: string[] = [];
  for (const action of actions)
    for (const from of statuses)
      for (const who of WHO) {
        try {
          out.push(`${action}: ${from} → ${transition(table, action, from, who)} (${who})`);
        } catch (e) {
          if (!isAppError(e)) throw e;
        }
      }
  return out;
}

describe("таблицы переходов", () => {
  it.each([
    ["заявка", REQUEST_TRANSITIONS, REQUEST_STATUSES, REQUEST_SPEC],
    ["отклик", OFFER_TRANSITIONS, OFFER_STATUSES, OFFER_SPEC],
    ["замер", MEASUREMENT_TRANSITIONS, MEASUREMENT_STATUSES, MEASUREMENT_SPEC],
  ] as const)("%s: разрешены ровно переходы из спецификации, все остальные запрещены", (_name, table, statuses, spec) => {
    expect(allowedCombos(table as Table<string, string>, statuses).sort()).toEqual([...spec].sort());
  });

  it("неверный статус — конфликт (данные уже изменились), чужая роль — нет прав", () => {
    expect(() => transition(REQUEST_TRANSITIONS, "chooseOffer", "OFFER_CHOSEN", "CLIENT")).toThrow(
      expect.objectContaining({ code: "CONFLICT" }),
    );
    expect(() => transition(REQUEST_TRANSITIONS, "chooseOffer", "OPEN", "EXECUTOR")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
