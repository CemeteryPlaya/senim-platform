/** Русское склонение: 1 (кроме 11), 2–4 (кроме 12–14), остальное. Общая для текстов всех зон `ru.app`. */
export function pluralForm(n: number): "one" | "few" | "many" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}
