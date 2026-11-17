/** ФИО как в удостоверении личности: пробелы схлопнуты, не короче 5 символов, хотя бы фамилия и имя. */
export function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidFullName(value: string): boolean {
  const name = normalizeFullName(value);
  return name.length >= 5 && name.length <= 120 && name.includes(" ");
}

/** «айгерим», «АЙГЕРИМ» → «Айгерим»; дефисные части — каждая отдельно. */
function capitalized(word: string): string {
  return word
    .split("-")
    .map((part) => {
      const [first = "", ...rest] = Array.from(part);
      const tail = rest.join("");
      return first.toLocaleUpperCase("ru") + (part === part.toLocaleUpperCase("ru") ? tail.toLocaleLowerCase("ru") : tail);
    })
    .join("-");
}

/**
 * Имя из ФИО «Фамилия Имя Отчество» (так его просит анкета) для публичной подписи: второе слово; одно слово — оно же;
 * ФИО нет — пустая строка.
 */
export function givenNameOf(fullName: string | null | undefined): string {
  const words = normalizeFullName(fullName ?? "").split(" ").filter(Boolean);
  const name = words[1] ?? words[0];
  return name ? capitalized(name) : "";
}

/** Подпись человека на публичной странице: имя («Айгерим») или инициал («А.»); ФИО нет — пустая строка. */
export function publicSignatureOf(fullName: string | null | undefined, kind: "NAME" | "INITIAL"): string {
  const name = givenNameOf(fullName);
  if (!name || kind === "NAME") return name;
  return `${Array.from(name)[0]}.`;
}
