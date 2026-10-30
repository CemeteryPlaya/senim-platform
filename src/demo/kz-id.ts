/**
 * Тестовые ИИН и БИН с корректной контрольной цифрой по алгоритму РК.
 * Порядковая часть номера — нули с маленьким счётчиком, чтобы номер был явно тестовым.
 */

const WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

/** Контрольная цифра для 11 первых цифр ИИН/БИН; null — для такой основы номер не выдаётся. */
export function kzCheckDigit(first11: string): number | null {
  if (!/^\d{11}$/.test(first11)) throw new Error("Нужно ровно 11 цифр");
  const digits = [...first11].map(Number);
  const sum = (weights: number[]) => digits.reduce((acc, d, i) => acc + d * weights[i], 0) % 11;
  const first = sum(WEIGHTS_1);
  if (first !== 10) return first;
  const second = sum(WEIGHTS_2);
  return second === 10 ? null : second;
}

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
