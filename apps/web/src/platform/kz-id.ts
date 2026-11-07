/** Контрольная цифра ИИН/БИН по алгоритму РК: проверка ввода (identity) и тестовые номера сида. */

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
