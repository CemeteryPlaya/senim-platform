import { isValidBin, isValidIin, parseKzIban } from "@/modules/identity/client";

/**
 * Проверка номеров в браузере до отправки — те же правила, что у схем identity (`isValidIin`, `isValidBin`,
 * `parseKzIban`): человек видит ошибку у поля сразу, а не после ответа сервера. Сервер проверяет всё равно.
 *
 * - `empty` — поле пустое (обязательность — дело схемы);
 * - `typing` — номер ещё набирается (ошибку не показывать);
 * - `short` — человек ушёл с поля, не дописав номер (или номер не того вида);
 * - `invalid` — номер полный, но в нём ошибка (контрольная цифра, дата, тип);
 * - `ok` — номер верный.
 */
export type IdCheck = "empty" | "typing" | "short" | "invalid" | "ok";

export type IdentityKind = "iin" | "bin";

/** ИИН или БИН из 12 цифр; `final` — человек ушёл с поля. */
export function checkIdentity(kind: IdentityKind, digits: string, final: boolean): IdCheck {
  if (digits.length === 0) return "empty";
  if (digits.length < 12) return final ? "short" : "typing";
  return (kind === "iin" ? isValidIin(digits) : isValidBin(digits)) ? "ok" : "invalid";
}

/** IBAN РК из 20 знаков (заглавные буквы и цифры, без пробелов); не «KZ» в начале — `short` (не тот вид номера). */
export function checkIban(sig: string, final: boolean): IdCheck {
  if (sig.length === 0) return "empty";
  if (sig.length < 20) return final ? "short" : "typing";
  const check = parseKzIban(sig);
  if (check.ok) return "ok";
  return check.reason === "checksum" ? "invalid" : "short";
}
