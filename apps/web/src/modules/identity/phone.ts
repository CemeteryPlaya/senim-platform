/** Телефон в формате E.164 (+77XXXXXXXXX). Получить можно только через parsePhone. */
export type Phone = string & { readonly __brand: "Phone" };

/**
 * Казахстанский мобильный номер из пользовательского ввода: «+7 700 …», «8 700 …», «700 …».
 * Мобильные номера РК начинаются с 7 после кода страны; остальное (в том числе +7 9xx) — null.
 */
export function parsePhone(raw: string): Phone | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  const national = digits.length === 11 && (digits[0] === "7" || digits[0] === "8") ? digits.slice(1) : digits;
  if (national.length !== 10 || national[0] !== "7") return null;
  return `+7${national}` as Phone;
}

/** «+7 700 000 01 01» — для показа пользователю. */
export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
