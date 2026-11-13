import { to } from "../../_shell/paths";

/** Роль, с которой гость идёт на вход: параметр адреса `role` (ссылки главной и «О сервисе»). */
export type LoginRole = "client" | "executor";
export const LOGIN_ROLES = ["client", "executor"] as const satisfies readonly LoginRole[];

/** Шаги экрана входа: выбор, номер, код. Шаг живёт в адресе (`?step=phone`), номер телефона — нет (это ПДн). */
export type LoginStep = "role" | "phone" | "code";

/**
 * Через сколько секунд identity примет новый запрос кода на тот же номер (`phoneCooldown` в
 * services/identity/internal/otp.go; текст отказа otp_too_often — «через минуту»).
 */
export const RESEND_SECONDS = 60;

export function parseLoginRole(value: unknown): LoginRole | null {
  return value === "client" || value === "executor" ? value : null;
}

/** Неизвестный или пустой шаг — первый. */
export function parseLoginStep(value: unknown): LoginStep {
  return value === "phone" || value === "code" ? value : "role";
}

/** Адрес входа с ролью: `/v2/login?role=client`. Параметр собирается здесь, а не строкой в разметке. */
export function loginHref(role: LoginRole): string {
  return `${to("/login")}?${new URLSearchParams({ role }).toString()}`;
}

/** Адрес шага входа с возвратом: `/v2/login?step=phone&next=%2Fv2%2Fdeals%2F1`. `next` уже проверен (safeNext). */
export function loginStepHref(step: LoginStep, next: string | null): string {
  const params = new URLSearchParams();
  if (step !== "role") params.set("step", step);
  if (next) params.set("next", next);
  const query = params.toString();
  return query ? `${to("/login")}?${query}` : to("/login");
}
