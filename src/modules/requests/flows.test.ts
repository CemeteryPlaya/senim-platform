import { describe, expect, it } from "vitest";
import { currentFlowStep, FLOW_STEPS, flowRules, pathOf, toleranceRange, withinTolerance, type FlowFacts } from "./flows";

const facts = (patch: Partial<FlowFacts>): FlowFacts => ({
  status: "OPEN",
  measurementDone: false,
  depositConfirmed: false,
  projectApproved: false,
  ...patch,
});

describe("сценарии до договора: правила из таблицы шагов", () => {
  it("каждый сценарий начинается с заявки и заканчивается работой по договору", () => {
    for (const steps of Object.values(FLOW_STEPS)) {
      expect(steps[0]).toMatch(/^request/);
      expect(steps.at(-1)).toBe("work");
      expect(steps).toContain("contract");
      expect(steps).toContain("project");
    }
  });

  it("правила сценариев совпадают с документом pre-contract-variants", () => {
    expect(flowRules("EXECUTOR_MEASURE")).toEqual({ executorVisit: true, deposit: false, siteMeasure: false, selfMeasure: false, projectBeforeContract: true });
    expect(flowRules("PLATFORM_MEASURER")).toEqual({ executorVisit: false, deposit: false, siteMeasure: true, selfMeasure: false, projectBeforeContract: true });
    expect(flowRules("CONTRACT_FIRST")).toEqual({ executorVisit: false, deposit: false, siteMeasure: false, selfMeasure: false, projectBeforeContract: false });
    expect(flowRules("MEASURE_DEPOSIT")).toEqual({ executorVisit: true, deposit: true, siteMeasure: false, selfMeasure: false, projectBeforeContract: true });
    expect(flowRules("SELF_MEASURE")).toEqual({ executorVisit: false, deposit: false, siteMeasure: false, selfMeasure: true, projectBeforeContract: true });
  });

  it("заявка без снимка сценария идёт путём ТЗ (торг → оферта); со снимком — своим сценарием", () => {
    expect(pathOf({ preContractFlow: null })).toBe("TZ");
    expect(pathOf({ preContractFlow: "SELF_MEASURE" })).toBe("SELF_MEASURE");
  });
});

describe("текущий шаг заявки", () => {
  it("сценарий 1: предложения → замер → проект → договор → работа", () => {
    const f = "EXECUTOR_MEASURE";
    expect(currentFlowStep(f, facts({ status: "DRAFT" }))).toBe("request");
    expect(currentFlowStep(f, facts({ status: "OPEN" }))).toBe("offers");
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN" }))).toBe("measure");
    expect(currentFlowStep(f, facts({ status: "MEASURING" }))).toBe("measure");
    expect(currentFlowStep(f, facts({ status: "MEASURING", measurementDone: true }))).toBe("project");
    expect(currentFlowStep(f, facts({ status: "MEASURING", measurementDone: true, projectApproved: true }))).toBe("contract");
    expect(currentFlowStep(f, facts({ status: "CONTRACTING" }))).toBe("contract");
    expect(currentFlowStep(f, facts({ status: "CLOSED", projectApproved: true }))).toBe("work");
    expect(currentFlowStep(f, facts({ status: "CANCELLED" }))).toBeNull();
  });

  it("сценарий 2: замер площадки до предложений, проект сразу после выбора", () => {
    const f = "PLATFORM_MEASURER";
    expect(currentFlowStep(f, facts({ status: "PLATFORM_MEASURING" }))).toBe("siteMeasure");
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN" }))).toBe("project");
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN", projectApproved: true }))).toBe("contract");
  });

  it("сценарий 3: договор сразу после выбора, проект — после подписи", () => {
    const f = "CONTRACT_FIRST";
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN" }))).toBe("contract");
    expect(currentFlowStep(f, facts({ status: "CONTRACTING" }))).toBe("contract");
    expect(currentFlowStep(f, facts({ status: "CLOSED" }))).toBe("project");
    expect(currentFlowStep(f, facts({ status: "CLOSED", projectApproved: true }))).toBe("work");
  });

  it("сценарий 4: залог до замера", () => {
    const f = "MEASURE_DEPOSIT";
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN" }))).toBe("deposit");
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN", depositConfirmed: true }))).toBe("measure");
    expect(currentFlowStep(f, facts({ status: "MEASURING", depositConfirmed: true, measurementDone: true }))).toBe("project");
  });

  it("сценарий 5: размеры в заявке, без выезда до договора", () => {
    const f = "SELF_MEASURE";
    expect(currentFlowStep(f, facts({ status: "DRAFT" }))).toBe("requestWithSizes");
    expect(currentFlowStep(f, facts({ status: "OFFER_CHOSEN" }))).toBe("project");
  });

  it("текущий шаг всегда есть в шкале своего сценария", () => {
    const statuses = ["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED"] as const;
    for (const flow of Object.keys(FLOW_STEPS) as (keyof typeof FLOW_STEPS)[]) {
      for (const status of statuses) {
        if (status === "PLATFORM_MEASURING" && flow !== "PLATFORM_MEASURER") continue;
        for (const bits of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const step = currentFlowStep(flow, facts({ status, measurementDone: !!(bits & 1), depositConfirmed: !!(bits & 2), projectApproved: !!(bits & 4) }));
          expect(FLOW_STEPS[flow] as readonly string[]).toContain(step);
        }
      }
    }
  });
});

describe("допуск цены ±15 %", () => {
  it("границы включительно, округление внутрь диапазона", () => {
    expect(toleranceRange(1_000_000)).toEqual({ min: 850_000, max: 1_150_000 });
    expect(toleranceRange(99_999)).toEqual({ min: 85_000, max: 114_998 });
    expect(withinTolerance(1_150_000, 1_000_000)).toBe(true);
    expect(withinTolerance(1_150_001, 1_000_000)).toBe(false);
    expect(withinTolerance(849_999, 1_000_000)).toBe(false);
  });
});
