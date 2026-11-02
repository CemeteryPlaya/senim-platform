import { describe, expect, it } from "vitest";
import { buildScenario, SCENARIO_STEPS, type ScenarioSnapshot } from "./scenario";

const client = { userId: "u-client", name: "Айгерим", role: "CLIENT" as const, phone: "+77000000101" };
const executor = { userId: "u-executor", name: "Ерлан", role: "EXECUTOR" as const, phone: "+77000000201" };
const operator = { userId: "u-operator", name: "Динара", role: "OPERATOR" as const, phone: "+77000000001" };

const full: ScenarioSnapshot = {
  operator,
  newRequest: { client },
  tender: { id: "r19", number: 19, client },
  signing: { id: "d14", number: 14, client },
  payment: { id: "d15", number: 15 },
  work: { id: "d11", number: 11, executor },
  act: { id: "d12", number: 12, client },
  payout: { id: "d13", number: 13 },
  completed: { id: "d7", number: 7, client },
};

describe("сценарий показа банку (manual)", () => {
  it("идёт по полному циклу одной сделки в фиксированном порядке", () => {
    expect(buildScenario(full).map((s) => s.key)).toEqual([...SCENARIO_STEPS]);
    expect(SCENARIO_STEPS).toEqual(["request", "offers", "contract", "payment", "work", "act", "payout", "closing"]);
  });

  it("каждый шаг ведёт на экран под нужной персоной; деньги проводит оператор", () => {
    const steps = Object.fromEntries(buildScenario(full).map((s) => [s.key, s]));
    expect(steps.request).toMatchObject({ href: "/requests/new", persona: client });
    expect(steps.offers).toMatchObject({ href: "/requests/r19", persona: client, number: 19 });
    expect(steps.contract).toMatchObject({ href: "/deals/d14", persona: client, number: 14 });
    expect(steps.payment).toMatchObject({ href: "/operator/deals/d15", persona: operator, number: 15 });
    expect(steps.work).toMatchObject({ href: "/deals/d11", persona: executor });
    expect(steps.act).toMatchObject({ href: "/deals/d12", persona: client });
    expect(steps.payout).toMatchObject({ href: "/operator/deals/d13", persona: operator });
    expect(steps.closing).toMatchObject({ href: "/deals/d7", persona: client });
  });

  it("недостающий шаг не ведёт никуда и не ломает остальные", () => {
    const steps = buildScenario({ operator: null });
    expect(steps.filter((s) => s.href !== null).map((s) => s.key)).toEqual(["request"]);
    expect(steps.find((s) => s.key === "request")?.persona).toBeNull();
  });
});
