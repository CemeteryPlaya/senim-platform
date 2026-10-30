import { describe, expect, it } from "vitest";
import { buildScenario, SCENARIO_STEPS, type ScenarioSnapshot } from "./scenario";

const client = { userId: "u-client", name: "Айгерим", role: "CLIENT" as const, phone: "+77000000101" };
const executor = { userId: "u-executor", name: "Ерлан", role: "EXECUTOR" as const, phone: "+77000000201" };

const full: ScenarioSnapshot = {
  railMode: "escrow-simulator",
  newRequest: { client },
  tender: { id: "r19", number: 19, offers: 3, client },
  measuring: { id: "r17", number: 17, executor },
  signing: { id: "d14", number: 14, client },
  deposit: { id: "d20", number: 20, client },
  inProgress: { id: "d11", number: 11, executor },
  completed: { id: "d7", number: 7, client },
};

describe("сценарий показа банку", () => {
  it("идёт по полному циклу в фиксированном порядке", () => {
    expect(buildScenario(full).map((s) => s.key)).toEqual([...SCENARIO_STEPS]);
    expect(SCENARIO_STEPS).toEqual(["request", "offers", "measurement", "contract", "deposit", "stages", "closing"]);
  });

  it("каждый шаг ведёт на экран под нужной персоной", () => {
    const steps = Object.fromEntries(buildScenario(full).map((s) => [s.key, s]));
    expect(steps.request).toMatchObject({ href: "/requests/new", persona: client });
    expect(steps.offers).toMatchObject({ href: "/requests/r19", persona: client, number: 19 });
    expect(steps.measurement).toMatchObject({ href: "/executor/measurements", persona: executor });
    expect(steps.deposit).toMatchObject({ href: "/deals/d20", extraHref: "/simulator", needsEscrow: false });
    expect(steps.stages).toMatchObject({ href: "/deals/d11", persona: executor });
  });

  it("без эскроу-сделки шаг пополнения не ведёт никуда и просит включить симулятор", () => {
    const steps = buildScenario({ ...full, railMode: "manual", deposit: undefined });
    expect(steps.find((s) => s.key === "deposit")).toMatchObject({ href: null, persona: null, needsEscrow: true });
  });

  it("недостающий шаг не ломает остальные", () => {
    const steps = buildScenario({ railMode: "manual" });
    expect(steps.every((s) => s.href === null || s.key === "request")).toBe(true);
  });
});
