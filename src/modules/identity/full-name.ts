/** ФИО как в удостоверении личности: пробелы схлопнуты, не короче 5 символов, хотя бы фамилия и имя. */
export function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidFullName(value: string): boolean {
  const name = normalizeFullName(value);
  return name.length >= 5 && name.length <= 120 && name.includes(" ");
}
