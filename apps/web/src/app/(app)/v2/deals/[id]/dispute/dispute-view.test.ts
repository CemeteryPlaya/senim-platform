import { describe, expect, it } from "vitest";
import { disputePositionSchema, openDisputeSchema } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { disputeOpenedBy, disputeScreen, disputeTexts, positionsOf, reasonText, REASONS, resolvedRefund, resolvedShare, TEXT_MAX, TEXT_MIN, textValid } from "./dispute-view";

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

describe("спор мастера", () => {
  it("тексты по стороне; причины мастера — те же ключи, что у модуля", () => {
    expect(disputeTexts("CLIENT")).toBe(ru.app.deal.dispute);
    expect(disputeTexts("EXECUTOR")).toBe(ru.app.masterDispute);
    expect(Object.keys(ru.app.masterDispute.reasons).sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) expect(ru.app.masterDispute.reasons[reason], reason).toMatch(/\S/);
  });

  it("последствия у мастера: «оплата вам приостановлена», у покупателя — как было", () => {
    expect(ru.app.masterDispute.form.nowNext).toBe("Оплата вам приостановится до решения оператора");
    expect(ru.app.masterDispute.open.now.body).toContain("Оплата вам приостановлена");
    expect(ru.app.deal.dispute.form.nowNext).toBe("Оплата мастеру приостановится до решения оператора");
  });

  it("позиции: своя и другой стороны", () => {
    const d = { clientPosition: "покупатель", executorPosition: "мастер" };
    expect(positionsOf("CLIENT", d)).toEqual({ mine: "покупатель", other: "мастер" });
    expect(positionsOf("EXECUTOR", d)).toEqual({ mine: "мастер", other: "покупатель" });
  });

  it("resolvedShare: часть мастера только при разделе; возврат целиком и деньги в банке — нет", () => {
    const completed = (paid: bigint, refunded: bigint) => ({ kind: "completed", paidToMasterTiyn: paid, refundedTiyn: refunded }) as MoneyBlock;
    expect(resolvedShare(completed(40n, 60n))).toBe(40n);
    expect(resolvedShare(completed(40n, 0n))).toBeNull();
    expect(resolvedShare({ kind: "refunded", amountTiyn: 100n } as MoneyBlock)).toBeNull();
    expect(resolvedShare({ kind: "protected" } as MoneyBlock)).toBeNull();
  });
});

describe("кто открыл спор и как называется причина", () => {
  it("открывший — по последнему событию dispute.opened; нет события или оператор — null", () => {
    expect(disputeOpenedBy([{ action: "dispute.opened", actorRole: "EXECUTOR" }])).toBe("EXECUTOR");
    expect(disputeOpenedBy([{ action: "dispute.opened", actorRole: "EXECUTOR" }, { action: "dispute.resolved", actorRole: "OPERATOR" }, { action: "dispute.opened", actorRole: "CLIENT" }])).toBe("CLIENT");
    expect(disputeOpenedBy([{ action: "deal.paid", actorRole: "CLIENT" }])).toBeNull();
    expect(disputeOpenedBy([{ action: "dispute.opened", actorRole: "OPERATOR" }])).toBeNull();
  });

  it("причина — словами открывшей стороны: мастер — нейтрально, покупатель и неизвестно — как у покупателя", () => {
    expect(reasonText("SCOPE", "EXECUTOR")).toBe(ru.app.masterDispute.reasons.SCOPE);
    expect(reasonText("SCOPE", "CLIENT")).toBe(ru.app.deal.dispute.reasons.SCOPE);
    expect(reasonText("SCOPE", null)).toBe(ru.app.deal.dispute.reasons.SCOPE);
    expect(ru.app.masterDispute.reasons.SCOPE).not.toBe(ru.app.deal.dispute.reasons.SCOPE);
  });

  it("позиция другой стороны — один ключ у обеих сторон", () => {
    expect(ru.app.deal.dispute.open.otherPosition).toBe("Позиция мастера");
    expect(ru.app.masterDispute.open.otherPosition).toBe("Позиция покупателя");
  });
});
