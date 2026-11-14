import { to } from "../../_shell/paths";

/** Шаги экрана почты: адрес, затем код из письма. Шаг живёт в адресе (`?step=code`), сам адрес почты — нет (это ПДн). */
export type EmailStep = "address" | "code";

/**
 * Через сколько секунд identity примет новый запрос кода (лимит «раз в минуту» в services/identity/internal/email.go;
 * текст отказа email_code_too_often — «через минуту»).
 */
export const EMAIL_RESEND_SECONDS = 60;

/** Неизвестный или пустой шаг — первый (адрес). */
export function parseEmailStep(value: unknown): EmailStep {
  return value === "code" ? "code" : "address";
}

/**
 * Адрес шага почты с возвратом: `/v2/email?step=code&next=%2Fv2%2Fdeals%2F1`. `next` уже проверен (safeNext).
 * `change` — смена уже подтверждённой почты из профиля (`?change=1`): возврата `next` у неё нет, она ведёт в контакты.
 */
export function emailStepHref(step: EmailStep, next: string | null, change = false): string {
  const params = new URLSearchParams();
  if (step !== "address") params.set("step", step);
  if (change) params.set("change", "1");
  else if (next) params.set("next", next);
  const query = params.toString();
  return query ? `${to("/email")}?${query}` : to("/email");
}
