import { describe, expect, it } from "vitest";
import { consentDocument, consentTextSha256 } from "@/modules/identity";
import type { StepUser } from "./auth";
import { onboardingPosition, pendingOnboarding } from "./onboarding";

const CURRENT = { id: "c1", version: consentDocument("PD_PROCESSING").version, textSha256: consentTextSha256("PD_PROCESSING") };

function client(over: Partial<StepUser> = {}): StepUser {
  return {
    role: "CLIENT",
    roles: ["CLIENT"],
    executor: null,
    fullName: "Сапаров Ерлан",
    iinLast4: "1234",
    emailVerified: true,
    mfa: { required: false, verifiedAt: null },
    consents: [CURRENT],
    consentRevocationOpen: false,
    ...over,
  };
}

describe("onboardingPosition: «Шаг N из 3», последовательность постоянна", () => {
  it("новичок: 1/3 → 2/3 → 3/3, без отката", () => {
    expect(onboardingPosition("consent")).toEqual({ step: 1, total: 3 });
    expect(onboardingPosition("welcome")).toEqual({ step: 2, total: 3 });
    expect(onboardingPosition("email")).toEqual({ step: 3, total: 3 });
  });
});

describe("pendingOnboarding: что осталось пройти", () => {
  it("новый человек: все три шага по порядку", () => {
    expect(pendingOnboarding(client({ consents: [], fullName: null, iinLast4: null, emailVerified: false }))).toEqual(["consent", "welcome", "email"]);
  });

  it("вернувшийся с согласием: знакомство и почта; с согласием и ФИО — только почта", () => {
    expect(pendingOnboarding(client({ fullName: null, iinLast4: null, emailVerified: false }))).toEqual(["welcome", "email"]);
    expect(pendingOnboarding(client({ emailVerified: false }))).toEqual(["email"]);
  });

  it("всё пройдено — пусто (обычная оболочка)", () => {
    expect(pendingOnboarding(client())).toEqual([]);
  });

  it("сотрудника площадки первые шаги не касаются", () => {
    expect(pendingOnboarding(client({ role: "OPERATOR", roles: ["OPERATOR"], consents: [], fullName: null, emailVerified: false }))).toEqual([]);
  });
});
