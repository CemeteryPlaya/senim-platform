/**
 * Вычистка персональных данных перед отправкой текста ИИ-провайдеру: ИИН/БИН, телефоны,
 * e-mail, адреса и имена заменяются метками. Это эвристика «лучше лишнее»: размеры, материалы
 * и названия брендов не трогаем, а всё похожее на человека или адрес — заменяем.
 */

const L = "\\p{L}";
const UP = "\\p{Lu}";
const LOW = "\\p{Ll}";
const notLetterBefore = `(?<![${L}])`;

const capWord = `[${UP}\\d][${L}\\d-]*`;
const houseNo = `\\d+[${L}]?(?:/\\d+)?`;

type Rule = { pattern: RegExp; replace: (match: string, ...groups: string[]) => string };
const label = (text: string) => () => text;

const rules: Rule[] = [
  // e-mail раньше всего: в нём бывают цифры, похожие на телефон.
  { pattern: new RegExp(`[${L}\\d._%+-]+@[${L}\\d.-]+\\.[${L}]{2,}`, "gu"), replace: label("[e-mail]") },
  // ИИН/БИН: 12 цифр, допускаются пробелы или дефисы между ними.
  { pattern: /(?<!\d)\d(?:[ -]?\d){11}(?!\d)/gu, replace: label("[ИИН]") },
  // Телефоны РК: +7 / 8 / 7 и 10 цифр, а также 10 цифр с кодом 7xx без префикса.
  {
    pattern: /(?:\+\s*7|(?<![\d+])[78])[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu,
    replace: label("[телефон]"),
  },
  { pattern: /(?<![\d+])7\d{2}[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu, replace: label("[телефон]") },
  // Жилой комплекс.
  { pattern: new RegExp(`${notLetterBefore}ЖК\\s*(?:«[^»]{1,40}»|"[^"]{1,40}"|[${UP}][${L}\\d-]*)`, "gu"), replace: label("[адрес]") },
  // Улица, проспект, микрорайон … с номером дома и квартиры.
  {
    pattern: new RegExp(
      `${notLetterBefore}(?:ул\\.|улица|пр\\.|пр-т|проспект|мкр\\.?|микрорайон|бульвар|б-р|шоссе|переулок|пер\\.)\\s*` +
        `${capWord}(?:\\s+${capWord}){0,2}` +
        `(?:,?\\s*(?:д\\.|дом)\\s*${houseNo})?` +
        `(?:,?\\s*(?:кв\\.|квартира)\\s*\\d+)?`,
      "giu",
    ),
    replace: label("[адрес]"),
  },
  // Отдельно указанные дом или квартира.
  { pattern: new RegExp(`${notLetterBefore}(?:кв\\.|квартира|дом|д\\.)\\s*№?\\s*${houseNo}`, "giu"), replace: label("[адрес]") },
  // «Меня зовут …», «С уважением, …»: следующие 1–3 слова с заглавной — имя.
  {
    pattern: new RegExp(
      `(${notLetterBefore}(?:[Мм]еня зовут|[Мм]о[её] имя|[Зз]овут|[Сс] уважением,?|[Оо]бращаться к|[Сс]просить))\\s+` +
        `[${UP}][${LOW}]+(?:[\\s-]+[${UP}][${LOW}]+){0,2}`,
      "gu",
    ),
    replace: (_m, phrase) => `${phrase} [имя]`,
  },
  // Имя и отчество.
  {
    pattern: new RegExp(`[${UP}][${LOW}]+\\s+[${UP}][${LOW}]+(?:ович|евич|ьич|ич|овна|евна|ична|инична)(?![${L}])`, "gu"),
    replace: label("[имя]"),
  },
  // Фамилия и инициалы: «Касымова М.А.», «М. А. Касымова».
  { pattern: new RegExp(`[${UP}][${LOW}]+\\s+[${UP}]\\.\\s?(?:[${UP}]\\.)?`, "gu"), replace: label("[имя]") },
  { pattern: new RegExp(`${notLetterBefore}[${UP}]\\.\\s?(?:[${UP}]\\.\\s?)?[${UP}][${LOW}]+`, "gu"), replace: label("[имя]") },
];

export function scrubPii(text: string): string {
  return rules.reduce((acc, rule) => acc.replace(rule.pattern, rule.replace), text);
}
