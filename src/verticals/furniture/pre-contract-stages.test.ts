import { describe, expect, it } from "vitest";
import { planStages } from "@/modules/deal-core";
import { firstStageTitle, templateForFlow } from "./pre-contract-stages";
import { STAGE_TEMPLATES } from "./stage-templates";

const sum = (t: { stages: readonly { sharePercent: number }[] }) => t.stages.reduce((s, x) => s + x.sharePercent, 0);

describe("первый этап договора по сценарию до договора", () => {
  it("сценарии 1 и 4 — этапы шаблона без изменений", () => {
    for (const flow of ["EXECUTOR_MEASURE", "MEASURE_DEPOSIT"] as const) {
      expect(templateForFlow(STAGE_TEMPLATES["advance-50"], flow)).toBe(STAGE_TEMPLATES["advance-50"]);
      expect(firstStageTitle(flow)).toBeNull();
    }
  });

  it("сценарии 2 и 5 — бесплатный контрольный замер первым этапом с условием пересчёта", () => {
    const platform = templateForFlow(STAGE_TEMPLATES["advance-50"], "PLATFORM_MEASURER");
    expect(platform.stages[0]).toMatchObject({ title: "Контрольный замер", sharePercent: 0 });
    expect(platform.stages[0]!.description).toContain("2 %");
    const self = templateForFlow(STAGE_TEMPLATES["no-prepayment"], "SELF_MEASURE");
    expect(self.stages[0]!.description).toContain("5 %");
    expect(self.stages.slice(1)).toEqual(STAGE_TEMPLATES["no-prepayment"].stages);
  });

  it("сценарий 3 — «Замер и проект» с долей 10 % за счёт первого оплачиваемого этапа, сумма долей 100 %", () => {
    for (const key of Object.keys(STAGE_TEMPLATES) as (keyof typeof STAGE_TEMPLATES)[]) {
      const t = templateForFlow(STAGE_TEMPLATES[key], "CONTRACT_FIRST");
      expect(t.stages[0]).toMatchObject({ title: "Замер и проект", sharePercent: 10 });
      expect(sum(t)).toBe(100);
      // deal-core принимает шаблон: этапы планируются без ошибки, сумма сделки сохраняется.
      expect(planStages(t, 1_000_000).reduce((s, x) => s + x.amount, 0)).toBe(1_000_000);
    }
    expect(templateForFlow(STAGE_TEMPLATES["advance-50"], "CONTRACT_FIRST").stages.map((s) => s.sharePercent)).toEqual([10, 40, 0, 50]);
  });
});
