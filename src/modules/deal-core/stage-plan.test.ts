import { describe, expect, it } from "vitest";
import { planStages, type StageTemplate } from "./stage-plan";

const advance: StageTemplate = {
  key: "advance",
  name: "С авансом",
  description: "",
  stages: [
    { title: "Материалы", description: "", sharePercent: 33, paymentDue: "ON_START" },
    { title: "Изготовление", description: "", sharePercent: 0, paymentDue: "ON_ACCEPTANCE" },
    { title: "Монтаж", description: "", sharePercent: 67, paymentDue: "ON_ACCEPTANCE" },
  ],
};

describe("planStages", () => {
  it("делит сумму по долям так, что сумма этапов равна сумме сделки до тенге", () => {
    const stages = planStages(advance, 1_000_001);
    expect(stages.map((s) => s.amount)).toEqual([330_000, 0, 670_001]);
    expect(stages.reduce((sum, s) => sum + s.amount, 0)).toBe(1_000_001);
  });

  it("нумерует этапы с единицы и сохраняет момент оплаты", () => {
    const stages = planStages(advance, 300_000);
    expect(stages.map((s) => [s.order, s.paymentDue])).toEqual([
      [1, "ON_START"],
      [2, "ON_ACCEPTANCE"],
      [3, "ON_ACCEPTANCE"],
    ]);
  });

  it("отклоняет шаблон, где доли не дают 100%", () => {
    const broken = { ...advance, stages: advance.stages.slice(0, 2) };
    expect(() => planStages(broken, 100_000)).toThrow(/100/);
  });

  it("отклоняет неположительную и дробную сумму", () => {
    for (const amount of [0, -100, 1.5]) expect(() => planStages(advance, amount)).toThrow("Сумма сделки должна быть положительной");
    expect(planStages(advance, 1).map((s) => s.amount)).toEqual([0, 0, 1]);
  });

  it("остаток — последнему этапу с долей, даже если он не последний и его сумма округлилась до нуля", () => {
    const paidFirst: StageTemplate = {
      ...advance,
      stages: [
        { title: "Всё сразу", description: "", sharePercent: 100, paymentDue: "ON_START" },
        { title: "Отчёт", description: "", sharePercent: 0, paymentDue: "ON_ACCEPTANCE" },
      ],
    };
    expect(planStages(paidFirst, 7).map((s) => s.amount)).toEqual([7, 0]);
    expect(planStages(advance, 2).map((s) => s.amount)).toEqual([0, 0, 2]);
    const reportLast: StageTemplate = {
      ...advance,
      stages: [
        { title: "Половина", description: "", sharePercent: 50, paymentDue: "ON_START" },
        { title: "Вторая половина", description: "", sharePercent: 50, paymentDue: "ON_ACCEPTANCE" },
        { title: "Отчёт", description: "", sharePercent: 0, paymentDue: "ON_ACCEPTANCE" },
      ],
    };
    expect(planStages(reportLast, 3).map((s) => s.amount)).toEqual([1, 2, 0]);
  });

  it("в тексте ошибки шаблона — ключ шаблона и сумма долей", () => {
    expect(() => planStages({ ...advance, stages: advance.stages.slice(0, 2) }, 100_000)).toThrow("Доли этапов шаблона «advance» дают 33%, а нужно 100%");
  });
});
