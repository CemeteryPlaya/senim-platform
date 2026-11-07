import type { KycStatus, Role } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";

/**
 * Проверка документов мастера (KYC, решение 2.2.8): ExecutorProfile.kycStatus.
 * Мастер загружает удостоверение (KYC_ID) и регистрацию ИП/ТОО (KYC_REGISTRATION) — статус PENDING;
 * оператор проверяет: VERIFIED или REJECTED с причиной. После отказа мастер загружает документы снова — PENDING.
 * Проверенные документы мастер не заменяет (CONFLICT): новая проверка — через оператора.
 */
export type KycAction = "submit" | "verify" | "reject";

export const KYC_TRANSITIONS = {
  submit: { from: ["PENDING", "REJECTED"], to: "PENDING", who: "EXECUTOR" },
  verify: { from: ["PENDING"], to: "VERIFIED", who: "OPERATOR" },
  reject: { from: ["PENDING"], to: "REJECTED", who: "OPERATOR" },
} as const satisfies Record<KycAction, { from: readonly KycStatus[]; to: KycStatus; who: Role }>;

/** hasDocuments — у профиля есть оба вида документов (удостоверение и регистрация). */
export type KycFacts = { status: KycStatus; hasDocuments: boolean };

const e = ru.identity.kyc.errors;

/** Куда ведёт действие: не та роль — FORBIDDEN; не то состояние (повтор, двойной клик) или нет документов — CONFLICT. */
export function kycTarget(action: KycAction, facts: KycFacts, who: Role): KycStatus {
  const rule = KYC_TRANSITIONS[action];
  if (who !== rule.who) return fail.forbidden();
  if (!(rule.from as readonly KycStatus[]).includes(facts.status)) {
    return fail.conflict(action === "submit" ? e.alreadyVerified : e.reviewed);
  }
  if (action !== "submit" && !facts.hasDocuments) return fail.conflict(e.noDocuments);
  return rule.to;
}

/** Экран мастера: NOT_SUBMITTED — профиль ещё PENDING, но документов нет (не путать с «на проверке»). */
export type KycState = "NOT_SUBMITTED" | KycStatus;

export function kycView(facts: KycFacts): { state: KycState; canSubmit: boolean } {
  const state: KycState = facts.status === "PENDING" && !facts.hasDocuments ? "NOT_SUBMITTED" : facts.status;
  return { state, canSubmit: (KYC_TRANSITIONS.submit.from as readonly KycStatus[]).includes(facts.status) };
}
