/**
 * Тестовые ИИН и БИН с корректной контрольной цифрой по алгоритму РК.
 * Порядковая часть номера — нули с маленьким счётчиком, чтобы номер был явно тестовым.
 */

import { kzCheckDigit } from "@/platform/kz-id";

export { kzCheckDigit };

function withCheckDigit(first11: string): string {
  const check = kzCheckDigit(first11);
  if (check === null) throw new Error(`Для основы ${first11} нет допустимой контрольной цифры — смените счётчик`);
  return first11 + check;
}

/**
 * ИИН: ГГММДД + цифра века и пола (3 — мужчина XX века, 4 — женщина XX века) + 4 цифры порядкового номера + контроль.
 */
export function testIin(birthYymmdd: string, centuryGender: 3 | 4 | 5 | 6, n: number): string {
  return withCheckDigit(`${birthYymmdd}${centuryGender}${String(n).padStart(4, "0")}`);
}

/** БИН юрлица-резидента (головное подразделение): ГГММ регистрации + «4» + «0» + 5 цифр номера + контроль. */
export function testBin(registeredYymm: string, n: number): string {
  return withCheckDigit(`${registeredYymm}40${String(n).padStart(5, "0")}`);
}
