import { describe, expect, it } from "vitest";
import { disputePositionSchema, openDisputeSchema } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { disputeScreen, REASONS, resolvedRefund, TEXT_MAX, TEXT_MIN, textValid } from "./dispute-view";

describe("disputeScreen: какой экран по состоянию спора", () => {
  const open = { status: "OPEN" as const };
  const resolved = { status: "RESOLVED" as const };
  it.each([
    ["спора нет, открыть можно — форма", null, true, "form"],
    ["спора нет, открыть нельзя — карточка сделки", null, false, "back"],
    ["спор открыт — его состояние", open, false, "open"],
    ["спор открыт (даже если модуль «разрешает») — его состояние", open, true, "open"],
    ["спор решён, открыть нельзя — итог", resolved, false, "resolved"],
    ["спор решён, сделка продолжается и открыть можно — форма", resolved, true, "form"],
  ] as const)("%s", (_name, dispute, canOpen, expected) => {
    expect(disputeScreen(dispute, canOpen)).toBe(expected);
  });
});

describe("границы текста совпадают с модулем deal-core", () => {
  const base = { dealId: "d1", reason: "OTHER" as const };
  it("описание спора", () => {
    expect(openDisputeSchema.safeParse({ ...base, description: "а".repeat(TEXT_MIN - 1) }).success).toBe(false);
    expect(openDisputeSchema.safeParse({ ...base, description: "а".repeat(TEXT_MIN) }).success).toBe(true);
    expect(openDisputeSchema.safeParse({ ...base, description: "а".repeat(TEXT_MAX) }).success).toBe(true);
    expect(openDisputeSchema.safeParse({ ...base, description: "а".repeat(TEXT_MAX + 1) }).success).toBe(false);
  });
  it("позиция", () => {
    expect(disputePositionSchema.safeParse({ disputeId: "x", position: "а".repeat(TEXT_MIN - 1) }).success).toBe(false);
    expect(disputePositionSchema.safeParse({ disputeId: "x", position: "а".repeat(TEXT_MIN) }).success).toBe(true);
    expect(disputePositionSchema.safeParse({ disputeId: "x", position: "а".repeat(TEXT_MAX + 1) }).success).toBe(false);
  });
  it("textValid не считает пробелы по краям", () => {
    expect(textValid("         а")).toBe(false);
    expect(textValid(` ${"а".repeat(TEXT_MIN)} `)).toBe(true);
  });
});

describe("resolvedRefund: возврат покупателю по журналу", () => {
  const completed =(paid: bigint, refunded: bigint) => ({ kind: "completed", paidToMasterTiyn: paid, refundedTiyn: refunded }) as MoneyBlock;
  it("раздел: только возврат (доля мастера не возвращается)", () => {
    expect(resolvedRefund(completed(40n, 60n))).toBe(60n);
  });
  it("выплата без возврата — нет", () => {
    expect(resolvedRefund(completed(40n, 0n))).toBeNull();
  });
  it("полный возврат", () => {
    expect(resolvedRefund({ kind: "refunded", amountTiyn: 100n } as MoneyBlock)).toBe(100n);
  });
  it("деньги ещё в банке — нет", () => {
    expect(resolvedRefund({ kind: "protected" } as MoneyBlock)).toBeNull();
  });
});

describe("причины спора", () => {
  it("список — перечисление модуля; у каждой причины есть текст, лишних текстов нет", () => {
    expect([...REASONS].sort()).toEqual(Object.values(DisputeReason).sort());
    for (const reason of REASONS) expect(ru.app.deal.dispute.reasons[reason], reason).toMatch(/\S/);
    expect(Object.keys(ru.app.deal.dispute.reasons).sort()).toEqual([...REASONS].sort());
  });
});
