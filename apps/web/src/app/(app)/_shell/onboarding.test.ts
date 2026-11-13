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

const NEWCOMER = client({ consents: [], fullName: null, iinLast4: null, emailVerified: false });

describe("onboardingPosition: «Шаг N из M» по тому, что осталось пройти", () => {
  it("новый человек: согласие — 1 из 3", () => {
    expect(pendingOnboarding(NEWCOMER)).toEqual(["consent", "welcome", "email"]);
    expect(onboardingPosition(NEWCOMER, "consent")).toEqual({ step: 1, total: 3 });
  });

  it("дальше оставшееся пересчитывается: знакомство — 1 из 2, почта — 1 из 1", () => {
    expect(onboardingPosition(client({ fullName: null, iinLast4: null, emailVerified: false }), "welcome")).toEqual({ step: 1, total: 2 });
    expect(onboardingPosition(client({ emailVerified: false }), "email")).toEqual({ step: 1, total: 1 });
  });

  it("вернувшийся: новая редакция согласия — единственный шаг, не «1 из 3»", () => {
    expect(onboardingPosition(client({ consents: [] }), "consent")).toEqual({ step: 1, total: 1 });
  });

  it("экран, которого нет среди непройденных, — 1 из 1", () => {
    expect(onboardingPosition(client(), "welcome")).toEqual({ step: 1, total: 1 });
  });

  it("сотрудника площадки первые шаги не касаются", () => {
    expect(pendingOnboarding(client({ role: "OPERATOR", roles: ["OPERATOR"], consents: [], fullName: null, emailVerified: false }))).toEqual([]);
  });
});
