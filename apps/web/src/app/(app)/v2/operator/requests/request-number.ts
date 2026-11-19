/** Наибольший номер заявки (`Request.number` — INT4): больше — заявки нет, в базу такой номер не уходит. */
const MAX_NUMBER = 2_147_483_647;

/** Номер заявки из адреса или формы «Открыть заявку»: только цифры (пробелы по краям — можно); иначе `null`. */
export function requestNumberOf(raw: string | undefined): number | null {
  const value = raw?.trim() ?? "";
  if (!/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_NUMBER ? n : null;
}
