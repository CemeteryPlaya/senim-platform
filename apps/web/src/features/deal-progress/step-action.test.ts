import { describe, expect, it } from "vitest";
import type { BankConsentState, DealView } from "@/modules/deal-core";
import { bankLocked, stepActionKind } from "./step-action";

const deal = (viewer: DealView["viewer"], action: string, mine = true) => ({ viewer, next: { action, mine } }) as unknown as DealView;
const bank = (mine: boolean, other: boolean) => ({ mine, other }) as unknown as BankConsentState;

describe("шаг закрыт до отметки банку-партнёру", () => {
  it("мастеру подпись оферты закрыта без своей отметки", () => {
    expect(bankLocked(deal("EXECUTOR", "signContract"), bank(false, true))).toBe(true);
    expect(bankLocked(deal("EXECUTOR", "signContract"), bank(true, false))).toBe(false);
  });

  it("покупателю оплата закрыта, пока нет обеих отметок", () => {
    expect(bankLocked(deal("CLIENT", "pay"), bank(true, false))).toBe(true);
    expect(bankLocked(deal("CLIENT", "pay"), bank(false, true))).toBe(true);
    expect(bankLocked(deal("CLIENT", "pay"), bank(true, true))).toBe(false);
  });

  it("без состояния отметки или на другом шаге — не закрыт", () => {
    expect(bankLocked(deal("CLIENT", "pay"), null)).toBe(false);
    expect(bankLocked(deal("CLIENT", "startWork"), bank(false, false))).toBe(false);
  });
});

describe("stepActionKind", () => {
  it("не моё действие или закрытый шаг — null, иначе само действие", () => {
    expect(stepActionKind(deal("CLIENT", "pay", false), bank(true, true))).toBeNull();
    expect(stepActionKind(deal("CLIENT", "pay"), bank(true, false))).toBeNull();
    expect(stepActionKind(deal("CLIENT", "pay"), bank(true, true))).toBe("pay");
  });
});
