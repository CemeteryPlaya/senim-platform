import { describe, expect, it } from "vitest";
import { isFullySigned, missingOf, requiredSignatures } from "./requirements";

const off = { executorHandSignsAct: false };
const on = { executorHandSignsAct: true };

describe("требуемые подписи (ADR-009, решение 2.2.4)", () => {
  it("оферта: обе стороны — собственноручно и ЭЦП", () => {
    expect(requiredSignatures("CONTRACT", off)).toEqual([
      { party: "CLIENT", hand: true, ecp: true },
      { party: "EXECUTOR", hand: true, ecp: true },
    ]);
  });

  it("акт: покупатель — собственноручно и ЭЦП, мастер — ЭЦП; собственноручно мастер — только при флаге", () => {
    expect(requiredSignatures("ACCEPTANCE_ACT", off)).toEqual([
      { party: "CLIENT", hand: true, ecp: true },
      { party: "EXECUTOR", hand: false, ecp: true },
    ]);
    expect(requiredSignatures("ACCEPTANCE_ACT", on)[1]).toEqual({ party: "EXECUTOR", hand: true, ecp: true });
  });

  it("выписка и расписка на подпись в приложении не идут", () => {
    expect(requiredSignatures("MONEY_STATEMENT", on)).toEqual([]);
    expect(requiredSignatures("RELEASE_RECEIPT", on)).toEqual([]);
  });
});

describe("полностью подписан = все требуемые подписи есть", () => {
  it("оферта не подписана, пока нет хотя бы одной из четырёх подписей", () => {
    expect(isFullySigned("CONTRACT", off, { hand: ["CLIENT", "EXECUTOR"], ecp: ["CLIENT"] })).toBe(false);
    expect(isFullySigned("CONTRACT", off, { hand: ["CLIENT", "EXECUTOR"], ecp: ["EXECUTOR", "CLIENT"] })).toBe(true);
  });

  it("акт без флага: собственноручная подпись мастера не нужна; с флагом — нужна", () => {
    const have = { hand: ["CLIENT" as const], ecp: ["CLIENT" as const, "EXECUTOR" as const] };
    expect(isFullySigned("ACCEPTANCE_ACT", off, have)).toBe(true);
    expect(isFullySigned("ACCEPTANCE_ACT", on, have)).toBe(false);
  });

  it("документ без требуемых подписей «полностью подписанным» не считается", () => {
    expect(isFullySigned("MONEY_STATEMENT", off, { hand: [], ecp: [] })).toBe(false);
  });
});

describe("чего не хватает стороне", () => {
  it("показывает только недостающие и требуемые подписи; оператор — ничего", () => {
    expect(missingOf("CONTRACT", off, "CLIENT", { hand: ["CLIENT"], ecp: [] })).toEqual({ hand: false, ecp: true });
    expect(missingOf("ACCEPTANCE_ACT", off, "EXECUTOR", { hand: [], ecp: [] })).toEqual({ hand: false, ecp: true });
    expect(missingOf("ACCEPTANCE_ACT", on, "EXECUTOR", { hand: [], ecp: [] })).toEqual({ hand: true, ecp: true });
    expect(missingOf("CONTRACT", off, null, { hand: [], ecp: [] })).toEqual({ hand: false, ecp: false });
  });
});
