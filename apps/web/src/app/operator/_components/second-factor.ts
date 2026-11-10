import type { ActionResult } from "@/platform/action";

/** Поле кода из приложения в формах оператора: появляется, когда действие ответило MFA_REQUIRED. */
export const MFA_CODE_FIELD = "mfaCode";

type Fields = Record<string, string | File>;

export type CodedRun<T> =
  /** Код не принят (неверный, повтор, лимит, сессия): действие не вызывалось. */
  | { step: "code"; result: Extract<ActionResult<unknown>, { ok: false }> }
  /** Действие вызвано (после принятого кода — `verified`). */
  | { step: "action"; verified: boolean; result: ActionResult<T> };

/**
 * Отправка формы оператора с полем кода: если в полях есть код из приложения, сначала он (verify — повторная
 * вторая ступень), затем само действие без этого поля. Нет кода — только действие.
 */
export async function runWithCode<T>(
  fields: Fields,
  action: (fields: Fields) => Promise<ActionResult<T>>,
  verify: (input: { code: string }) => Promise<ActionResult<unknown>>,
): Promise<CodedRun<T>> {
  const { [MFA_CODE_FIELD]: code, ...rest } = fields;
  let verified = false;
  if (typeof code === "string") {
    const checked = await verify({ code });
    if (!checked.ok) return { step: "code", result: checked };
    verified = true;
  }
  return { step: "action", verified, result: await action(rest) };
}
