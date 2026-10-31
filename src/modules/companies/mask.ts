import { ru } from "@/i18n/ru";

/**
 * Маскирование контактов в тексте чата и публичных описаниях (ADR-003).
 * Чистые функции без БД: исходный текст после маски нигде не хранится.
 *
 * Как устроено: каждый детектор возвращает отрезки [start, end) исходного текста,
 * отрезки объединяются и заменяются на MASK, соседние MASK склеиваются.
 * Телефоны ищутся по «цепочкам чисел» (цифры и числительные словами), а суммы,
 * даты и номера документов заранее закрываются, чтобы не дать ложных срабатываний.
 */
export const MASK = ru.companies.chat.maskPlaceholder;

export type MaskResult = { text: string; masked: boolean };

type Span = readonly [start: number, end: number];

export function maskContacts(input: string): MaskResult {
  const text = normalize(input);
  const spans = [...findTextContacts(text), ...findLookalikeContacts(text), ...findPhones(text)];
  if (spans.length === 0) return { text, masked: false };
  return { text: collapseMasks(replaceSpans(text, spans)), masked: true };
}

/** Контакты, записанные буквами: e-mail, ссылки, ники, мессенджеры. */
function findTextContacts(text: string): Span[] {
  return [...findEmails(text), ...findLinks(text), ...findNicks(text), ...findMessengers(text)];
}

/**
 * Кириллические двойники латиницы в ссылках и никах: «t.mе» (е — кириллическая), «whаtsapp».
 * Ищем в копии текста с двойниками, заменёнными на латиницу (длина та же — позиции совпадают).
 * Засчитываем только находки, где в исходнике есть хоть одна латинская буква: чисто русский текст
 * («т.е.», «@Иван») копия превращает в латиницу целиком — это не контакт.
 */
function findLookalikeContacts(text: string): Span[] {
  const latin = text.replace(CYRILLIC_LOOKALIKE, (c) => LATIN_OF[c]);
  if (latin === text) return [];
  return findTextContacts(latin).filter(([start, end]) => /[a-z]/i.test(text.slice(start, end)));
}

/**
 * Скрывает наименование или ФИО исполнителя в его публичных текстах («о себе», портфолио).
 * Форма (ТОО, ИП) и кавычки отбрасываются; слишком короткое имя не ищем — будет ложное срабатывание.
 */
export function maskIdentity(text: string, legalName: string): string {
  const core = stripInvisible(legalName)
    .replace(/(?<!\p{L})(?:ТОО|ИП|АО|ЧП|LLP|TOO)(?!\p{L})/gu, " ")
    .replace(/[«»"“”„']/g, " ")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  const clean = stripInvisible(text);
  if (core.join(" ").length < 4) return clean;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${core.map(escapeRegExp).join("[\\s\\-]+")}(?![\\p{L}\\p{N}])`, "giu");
  return clean.replace(pattern, MASK);
}

/**
 * Скрывает слова ФИО владельца (от 4 букв) по отдельности: «Ерлан», «Жумабаев», и с короткими
 * окончаниями падежей («Ерлану»). Короткие слова не ищем — будет ложное срабатывание.
 */
export function maskNameWords(text: string, fullName: string | null | undefined): string {
  const words = stripInvisible(fullName ?? "")
    .split(/[\s-]+/)
    .filter((w) => (w.match(/\p{L}/gu)?.length ?? 0) >= 4);
  const clean = stripInvisible(text);
  if (words.length === 0) return clean;
  // Имя и фамилия подряд — одна маска.
  const word = `(?:${words.map(escapeRegExp).join("|")})\\p{L}{0,2}(?![\\p{L}\\p{N}])`;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${word}(?:[\\s\\-]+${word})*`, "giu");
  return clean.replace(pattern, MASK);
}

/* ── Нормализация: обходы маски невидимыми символами и «чужими» цифрами ── */

/** Невидимые символы форматирования (U+200B, U+2060, U+00AD, U+FEFF…) — ими разбивают номер и имя. */
const INVISIBLE = /\p{Cf}/gu;
const stripInvisible = (text: string) => text.replace(INVISIBLE, "");

const ANY_DIGIT = /\p{Nd}/u;
/** Эмодзи-цифра «8️⃣»: цифра, (необязательный) селектор варианта и рамка клавиши. */
const KEYCAP = /([0-9#*])️?⃣/gu;

/**
 * Значение цифры любой системы (арабско-индийской, деванагари, математической…): в Юникоде цифры
 * \p{Nd} идут подряд блоками по десять, начиная с нуля, — значение равно числу цифр перед ней по модулю 10.
 */
function digitValue(ch: string): number {
  const cp = ch.codePointAt(0)!;
  let before = 0;
  while (before < 60 && ANY_DIGIT.test(String.fromCodePoint(cp - before - 1))) before += 1;
  return before % 10;
}

/** «Пустые» буквы, которые выглядят как пробел (пустой символ Брайля, хангыльские заполнители). */
const BLANK_LETTERS = /[\u2800\u3164\u115F\u1160\uFFA0]/gu;

/**
 * Числа-знаки \p{No} без разложения NFKC: тёмные и двойные обведённые «❶ ⓫ ⓵ ⓿ 🄋» —
 * [первый код, последний код, значение первого].
 */
const DINGBAT_NUMBERS: readonly (readonly [from: number, to: number, first: number])[] = [
  [0x2776, 0x277f, 1],
  [0x2780, 0x2789, 1],
  [0x278a, 0x2793, 1],
  [0x24eb, 0x24f4, 11],
  [0x24f5, 0x24fe, 1],
  [0x24ff, 0x24ff, 0],
  [0x1f10b, 0x1f10c, 0],
];

/** Цифры знака \p{No}: «⁸» → «8», «⑩» → «10», «⑴» → «1», «❶» → «1»; дроби «½» и прочее — null. */
function otherNumberDigits(ch: string): string | null {
  const nfkc = ch.normalize("NFKC");
  if (/^\(?\d+[.,)]?$/.test(nfkc)) return nfkc.replace(/\D/g, "");
  const cp = ch.codePointAt(0)!;
  const range = DINGBAT_NUMBERS.find(([from, to]) => cp >= from && cp <= to);
  return range ? String(range[2] + cp - range[0]) : null;
}

/**
 * Текст, в котором ищутся контакты (он же сохраняется): без невидимых символов, полноширинные знаки
 * («７０１…», «ｗａ．ｍｅ»), цифры любых систем и числа-знаки («⁸⁷⁰», «⑧⑦⓪», «❽❼⓿») — обычные.
 * Знак сразу после буквы не трогаем: это степень или сноска («м²», «см³», «текст¹»).
 * Полный NFKC не годится — он меняет «№» и «м²».
 */
function normalize(input: string): string {
  return stripInvisible(input)
    .replace(BLANK_LETTERS, " ")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(KEYCAP, "$1")
    .replace(/(?![0-9])\p{Nd}/gu, (d) => String(digitValue(d)))
    .replace(/(?<!\p{L})\p{No}/gu, (c) => otherNumberDigits(c) ?? c);
}

/**
 * Кириллические буквы, неотличимые от латинских (а, е, о, р, с, х, у, к, м, т, н, в; казахская і):
 * ими пишут «t.mе», «whаtsapp». Одна буква — одна буква: позиции в тексте не сдвигаются.
 */
const LATIN_OF: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", к: "k", м: "m", т: "t", н: "h", в: "b", і: "i",
  А: "A", Е: "E", О: "O", Р: "P", С: "C", Х: "X", У: "Y", К: "K", М: "M", Т: "T", Н: "H", В: "B", І: "I",
};
const CYRILLIC_LOOKALIKE = new RegExp(`[${Object.keys(LATIN_OF).join("")}]`, "gu");

/* ── Детекторы ─────────────────────────────────────────────────────────── */

const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;
// Обход маски словами и пробелами: «ivan собака gmail точка com», «ivan (at) mail (dot) ru», «ivan @ gmail . com».
const AT = "\\s*(?:@|[(\\[]\\s*(?:at|собака)\\s*[)\\]]|\\sat\\s|собака)\\s*";
const DOT = "\\s*(?:\\.|[(\\[]\\s*(?:dot|точка)\\s*[)\\]]|\\sdot\\s|точка)\\s*";
const EMAIL_SPELLED = new RegExp(`${NOT_WORD_BEFORE}[a-z0-9._%+-]+${AT}[a-z0-9-]+(?:${DOT}[a-z0-9-]+)*${DOT}[a-z]{2,}${NOT_WORD_AFTER}`, "giu");

function findEmails(text: string): Span[] {
  return [...matchAll(text, EMAIL), ...matchAll(text, EMAIL_SPELLED)];
}

const TLD = "com|kz|ru|me|org|net|io|app|ly|link|info|biz|site|online|shop|store|uz|kg|by|ua|su|pro|gl|co|cc|tv|рф|қаз";
const URL_WITH_SCHEME = /(?:https?:\/\/|www\.)[^\s<>"«»]+/giu;
const BARE_DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}@._-])(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?\\.)+(?:${TLD})(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"«»]*)?`,
  "giu",
);
// Домен с пробелами или словами вокруг точек и косой черты: «t . me / mebel», «mebel точка kz». Только латиница —
// иначе «т. е.» и сокращения в русском тексте дадут ложные срабатывания. Первая часть — с буквой («Модель 3. Pro» —
// не домен); редкий домен без пути («loft. Pro…») похож на конец предложения — нужен путь «/…».
const LATIN_TLD = TLD.split("|").filter((t) => /^[a-z]+$/.test(t)).join("|");
const COMMON_TLD = "com|kz|ru|me|org|net";
const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const TLD_END = "(?![\\p{L}\\p{N}-])";
const SPACED_DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}@._-])(?=[a-z0-9-]*[a-z])${LABEL}(?:${DOT}${LABEL})*${DOT}` +
    `(?:(?:${LATIN_TLD})${TLD_END}\\s*\\/\\s*[a-z0-9_.-]+|(?:${COMMON_TLD})${TLD_END})`,
  "giu",
);
const TRAILING_PUNCTUATION = /[.,!?;:)»"']+$/u;

function findLinks(text: string): Span[] {
  return [...matchAll(text, URL_WITH_SCHEME), ...matchAll(text, BARE_DOMAIN), ...matchAll(text, SPACED_DOMAIN)].map(([start, end]) => {
    const tail = TRAILING_PUNCTUATION.exec(text.slice(start, end));
    return [start, end - (tail?.[0].length ?? 0)] as const;
  });
}

// «@mebel» и «@ mebel» (с пробелом — только ник с буквой: «@ 10:00» — не ник).
const NICK = /(?<![\p{L}\p{N}_.@])@(?:\s{1,3}(?=[a-z0-9_.]*[a-z]))?[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])+/giu;

function findNicks(text: string): Span[] {
  return matchAll(text, NICK);
}

const MESSENGER_WORDS = [
  "whats\\s?app\\p{L}*",
  "в[ао]тс?\\s?ап+\\p{L}*",
  "в[ао]ц+ап+\\p{L}*",
  "telegram\\p{L}*",
  "телеграм+\\p{L}*",
  "телег[аеиуо]й?",
  "instagram\\p{L}*",
  "insta",
  "инстаграм+\\p{L}*",
  "инст(?:[аеуыо]й?)?",
  "viber\\p{L}*",
  "вайбер\\p{L}*",
  "вибер\\p{L}*",
  "skype\\p{L}*",
  "скайп\\p{L}*",
  "вконтакт\\p{L}*",
  "vkontakte",
  "vk",
  "вк",
  "facebook\\p{L}*",
  "фейсбук\\p{L}*",
  "fb",
  "tik\\s?tok\\p{L}*",
  "тик\\s?ток\\p{L}*",
  "wechat",
  "discord\\p{L}*",
  "дискорд\\p{L}*",
];
// Латинский ник сразу после мессенджера («инст mebel_astana», «Telegram: mebel.astana») — тоже контакт.
const HANDLE_AFTER = "(?:\\s*[:\\-–—]?\\s*@?\\s*[a-z0-9_.]{2,}[a-z0-9_])?";
const MESSENGER = new RegExp(`${NOT_WORD_BEFORE}(?:${MESSENGER_WORDS.join("|")})${HANDLE_AFTER}${NOT_WORD_AFTER}`, "giu");
/** Ник с буквой: «mebel_astana», «@mebel», «@ mebel». */
const HANDLE = "@?\\s*(?=[a-z0-9_.]*[a-z_])[a-z0-9_.]{2,}[a-z0-9_]";
// Сокращения — ещё и обычные слова («тг» — «тенге»), поэтому контакт только вместе с ником:
// «тг mebel_astana», «tg: @mebel», «ig mebel.astana», «wa: mebel».
const SHORT_MESSENGER = new RegExp(`${NOT_WORD_BEFORE}(?:тг|tg|ig|wa|tt)\\s*[:\\-–—]?\\s*${HANDLE}${NOT_WORD_AFTER}`, "giu");
// «max»/«макс» (мессенджер MAX) — ещё и «максимум» («max ширина»): нужен ещё и знак «:» или «@» перед ником.
const LABELED_MESSENGER = new RegExp(`${NOT_WORD_BEFORE}(?:max|макс)\\s*(?::\\s*|(?=@))${HANDLE}${NOT_WORD_AFTER}`, "giu");

function findMessengers(text: string): Span[] {
  return [...matchAll(text, MESSENGER), ...matchAll(text, SHORT_MESSENGER), ...matchAll(text, LABELED_MESSENGER)];
}

/* ── Телефоны ──────────────────────────────────────────────────────────── */

// Что заведомо не телефон: даты, суммы с разделителями тысяч (и их диапазоны), номера документов.
const AMOUNT = "\\d{1,3}(?:[ \\u00A0\\u202F]\\d{3})+";
// Разделители между частями номера: пробелы любой длины и до трёх знаков препинания или «=», «~», «|»
// между ними: «8 700», «8-700», «8(700)», «8.700», «8:700», «8*700», «8=700», «8 · 700». «+», «№», валюта
// и «×» (размеры «900×600») разделителями не считаются.
const SEP_MARK = "[\\p{P}=~|]";
const GAP_SRC = `\\s*(?:${SEP_MARK}\\s*){0,3}`;
const PROTECTED = [
  /(?<![\d.])(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[0-2])[./](?:\d{4}|\d{2})(?!\d)/gu,
  /(?<!\d)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)/gu,
  // Сумма «1 350 000» или диапазон «700 000 – 1 000 000», за которой не идут ещё цифры (иначе это телефон «8 700 123 45 67»).
  new RegExp(`(?<![\\d+])(?<!\\d${GAP_SRC})${AMOUNT}(?:\\s*[-–—]\\s*${AMOUNT})?(?!${GAP_SRC}\\d)`, "gu"),
  /[№#]\s*\d+/gu,
];

/**
 * Размеры «900*600*2400», «2400х600», «проём 900/2100»: 2–3 числа по 2–4 цифры через *, x, х, ×, / — и дальше цифр нет.
 * Заказчики пишут их постоянно. Но «8701*123*4567» — номер в той же записи: такие цифры (kzMobileDigits) не закрываем.
 */
const DIMENSIONS = /(?<![\d*xх×/+])\d{2,4}(?:\s*[*xх×/]\s*\d{2,4}){1,2}(?!\s*[*xх×/]?\s*\d)/gu;

/** Коды мобильных операторов Казахстана: 700–708, 747, 770–779 (с запасом на новые коды). */
const KZ_MOBILE_CODE = /^7(?:0[0-8]|47|7\d)/;

/** Цифры подряд похожи на казахстанский мобильный: 7/8 + код оператора + 7 цифр, или код оператора + 7 цифр. */
export function kzMobileDigits(digits: string): boolean {
  if (digits.length === 11) return /^[78]/.test(digits) && KZ_MOBILE_CODE.test(digits.slice(1));
  if (digits.length === 10) return KZ_MOBILE_CODE.test(digits);
  return false;
}
const PROTECTED_CHAR = "";

/**
 * Буквы-двойники цифр рядом с цифрами: «87O1…», «7ОО» (латинская и кириллическая O) → 0, «70l», «I23» → 1.
 * Только в копии для поиска телефонов (буква — цифра, позиции те же); слово из таких букв («ООО») не трогаем.
 */
const DIGIT_LOOKALIKE = /(?<=\d)[OoОоlI]+(?!\p{L})|(?<!\p{L})[OoОоlI]+(?=\d)/gu;
const lookalikesAsDigits = (text: string) => text.replace(DIGIT_LOOKALIKE, (m) => m.replace(/[OoОо]/g, "0").replace(/[lI]/g, "1"));

// После числа — валюта или единица измерения: это цена или размер, если число не похоже на номер (phoneShaped).
const UNIT_AFTER = /^[\s ]*(?:₸|тг|тенге|kzt|руб|р\.|₽|\$|usd|долл|eur|€|тыс|млн|млрд|мм|см|м(?!\p{L})|метр|кг|шт|%)/iu;
const GAP = new RegExp(`^${GAP_SRC}$`, "u");
const TOKEN = /\d+|\p{L}+/gu;

type WordKind = "zero" | "unit" | "teen" | "ten" | "hundred";
const NUMBER_WORDS: Record<string, readonly [WordKind, number]> = {
  ноль: ["zero", 0], нуль: ["zero", 0],
  один: ["unit", 1], одна: ["unit", 1], одно: ["unit", 1], два: ["unit", 2], две: ["unit", 2], три: ["unit", 3],
  четыре: ["unit", 4], пять: ["unit", 5], шесть: ["unit", 6], семь: ["unit", 7], восемь: ["unit", 8], девять: ["unit", 9],
  десять: ["teen", 10], одиннадцать: ["teen", 11], двенадцать: ["teen", 12], тринадцать: ["teen", 13],
  четырнадцать: ["teen", 14], пятнадцать: ["teen", 15], шестнадцать: ["teen", 16], семнадцать: ["teen", 17],
  восемнадцать: ["teen", 18], девятнадцать: ["teen", 19],
  двадцать: ["ten", 20], тридцать: ["ten", 30], сорок: ["ten", 40], пятьдесят: ["ten", 50],
  шестьдесят: ["ten", 60], семьдесят: ["ten", 70], восемьдесят: ["ten", 80], девяносто: ["ten", 90],
  сто: ["hundred", 100], двести: ["hundred", 200], триста: ["hundred", 300], четыреста: ["hundred", 400],
  пятьсот: ["hundred", 500], шестьсот: ["hundred", 600], семьсот: ["hundred", 700], восемьсот: ["hundred", 800],
  девятьсот: ["hundred", 900],
  // Казахские: «жеті жүз бір» — 701 (число сотен стоит перед «жүз»), «он бір» — 11.
  нөл: ["zero", 0], нөль: ["zero", 0],
  бір: ["unit", 1], екі: ["unit", 2], үш: ["unit", 3], төрт: ["unit", 4], бес: ["unit", 5],
  алты: ["unit", 6], жеті: ["unit", 7], сегіз: ["unit", 8], тоғыз: ["unit", 9],
  он: ["ten", 10], жиырма: ["ten", 20], отыз: ["ten", 30], қырық: ["ten", 40], елу: ["ten", 50],
  алпыс: ["ten", 60], жетпіс: ["ten", 70], сексен: ["ten", 80], тоқсан: ["ten", 90],
  жүз: ["hundred", 100],
  // Английские: «seven hundred one» — 701, как в казахском.
  zero: ["zero", 0],
  one: ["unit", 1], two: ["unit", 2], three: ["unit", 3], four: ["unit", 4], five: ["unit", 5],
  six: ["unit", 6], seven: ["unit", 7], eight: ["unit", 8], nine: ["unit", 9],
  ten: ["teen", 10], eleven: ["teen", 11], twelve: ["teen", 12], thirteen: ["teen", 13], fourteen: ["teen", 14],
  fifteen: ["teen", 15], sixteen: ["teen", 16], seventeen: ["teen", 17], eighteen: ["teen", 18], nineteen: ["teen", 19],
  twenty: ["ten", 20], thirty: ["ten", 30], forty: ["ten", 40], fifty: ["ten", 50],
  sixty: ["ten", 60], seventy: ["ten", 70], eighty: ["ten", 80], ninety: ["ten", 90],
  hundred: ["hundred", 100],
};

/**
 * Казахские буквы часто заменяют русскими или латиницей: «жуз» вместо «жүз», «бiр» (латинская i) вместо «бір».
 * Слово ищется в словаре после той же замены.
 */
const KAZAKH_PLAIN: Record<string, string> = { ү: "у", ұ: "у", ө: "о", ғ: "г", қ: "к", ң: "н", ә: "а", һ: "х", i: "і" };
const plainWord = (word: string) => word.replace(/[үұөғқңәһi]/g, (c) => KAZAKH_PLAIN[c]);
const NUMBER_WORD = new Map(Object.entries(NUMBER_WORDS).map(([word, value]) => [plainWord(word), value]));
const numberWord = (word: string) => NUMBER_WORD.get(plainWord(word));

/** Слова «сотня», перед которыми стоит число сотен: «жеті жүз», «seven hundred». */
const MULTIPLIED_HUNDREDS = new Set(["жүз", "hundred"].map(plainWord));
const PLUS_WORDS = new Set(["плюс", "plus"]);

/** Число в цепочке: «87001234567», «семьсот один» (одна группа из нескольких слов) или «45». */
type NumberGroup = { start: number; end: number; digits: string; written: "digits" | "words" };
type Token = { start: number; end: number; text: string; word?: readonly [WordKind, number] };

function findPhones(text: string): Span[] {
  const scan = protect(lookalikesAsDigits(text));
  const spans: Span[] = [];
  for (const chain of numberChains(scan)) spans.push(...phonesInChain(scan, chain));
  return spans;
}

/** Закрывает даты, суммы, номера документов и время символом той же длины: позиции совпадают с исходным текстом. */
function protect(text: string): string {
  let scan = text;
  for (const re of PROTECTED) {
    scan = scan.replace(re, (m) => PROTECTED_CHAR.repeat(m.length));
  }
  scan = scan.replace(DIMENSIONS, (m) => (kzMobileDigits(m.replace(/\D/g, "")) ? m : PROTECTED_CHAR.repeat(m.length)));
  return protectTimes(scan);
}

// Время «9:00», «18:30» — но не части номера «8:701:123:45:67».
const TIME = /(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?![\d:])/gu;
const DIGIT_THEN_GAP = new RegExp(`\\d${GAP_SRC}$`, "u");

/**
 * Время сразу после цифр («8 701 123 12:34») — хвост номера, а не время. Проверяем по уже закрытому тексту:
 * в «9:00-18:00, 9:00-17:00» каждое следующее время идёт после закрытого предыдущего, а не после цифры.
 */
function protectTimes(scan: string): string {
  let out = scan;
  for (const m of scan.matchAll(TIME)) {
    if (DIGIT_THEN_GAP.test(out.slice(Math.max(0, m.index - 64), m.index))) continue;
    out = out.slice(0, m.index) + PROTECTED_CHAR.repeat(m[0].length) + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Цепочки идущих подряд чисел (цифрами или словами) с короткими разделителями между ними. */
function numberChains(scan: string): { plusAt: number | null; groups: NumberGroup[] }[] {
  const chains: { plusAt: number | null; groups: NumberGroup[] }[] = [];
  let tokens: Token[] = [];
  let plusAt: number | null = null;

  const flush = () => {
    if (tokens.length > 0) chains.push({ plusAt, groups: groupTokens(tokens) });
    tokens = [];
    plusAt = null;
  };

  for (const m of scan.matchAll(TOKEN)) {
    const token = { start: m.index, end: m.index + m[0].length, text: m[0].toLowerCase() };
    const isNumber = /^\d+$/.test(token.text) || numberWord(token.text) !== undefined;
    const last = tokens.at(-1);
    if (last && !GAP.test(scan.slice(last.end, token.start))) flush();
    if (PLUS_WORDS.has(token.text)) {
      flush();
      plusAt = token.start;
      continue;
    }
    if (!isNumber) {
      flush();
      continue;
    }
    if (tokens.length === 0 && plusAt === null) plusAt = plusSignBefore(scan, token.start);
    tokens.push(token);
  }
  flush();
  return chains;
}

function plusSignBefore(scan: string, start: number): number | null {
  const m = /\+[\s(]*$/u.exec(scan.slice(Math.max(0, start - 4), start));
  return m ? start - m[0].length : null;
}

/** Слова-числительные складываются в группы: «семьсот один» → 701, «сорок пять» → 45, «ноль» → 0. */
function groupTokens(tokens: Token[]): NumberGroup[] {
  const groups: NumberGroup[] = [];
  let open: { group: NumberGroup; value: number; has: Set<WordKind> } | null = null;

  for (const token of mergeMultipliedHundreds(tokens)) {
    const word = token.word ?? numberWord(token.text);
    if (!word) {
      groups.push({ start: token.start, end: token.end, digits: token.text, written: "digits" });
      open = null;
      continue;
    }
    const [kind, value] = word;
    if (open && canExtend(open.has, kind)) {
      open.value += value;
      open.has.add(kind);
      open.group.end = token.end;
      open.group.digits = String(open.value);
      continue;
    }
    const group: NumberGroup = { start: token.start, end: token.end, digits: String(value), written: "words" };
    groups.push(group);
    open = kind === "zero" ? null : { group, value, has: new Set([kind]) };
  }
  return groups;
}

/** «жеті жүз», «seven hundred» → одно слово-сотня 700: число сотен стоит перед «жүз»/«hundred». */
function mergeMultipliedHundreds(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const prev = out.at(-1);
    const prevWord = prev && !prev.word ? numberWord(prev.text) : undefined;
    if (prev && MULTIPLIED_HUNDREDS.has(plainWord(token.text)) && prevWord?.[0] === "unit") {
      out[out.length - 1] = { start: prev.start, end: token.end, text: token.text, word: ["hundred", prevWord[1] * 100] };
      continue;
    }
    out.push(token);
  }
  return out;
}

function canExtend(has: Set<WordKind>, next: WordKind): boolean {
  if (has.has("unit") || has.has("teen")) return false;
  if (next === "unit") return has.has("hundred") || has.has("ten");
  if (next === "ten" || next === "teen") return has.has("hundred") && !has.has("ten");
  return false;
}

/** Внутри цепочки ищем самые длинные подряд идущие группы, похожие на телефон; остальное не трогаем. */
function phonesInChain(scan: string, chain: { plusAt: number | null; groups: NumberGroup[] }): Span[] {
  const { groups } = chain;
  const spans: Span[] = [];
  let i = 0;
  while (i < groups.length) {
    const found = longestPhoneFrom(scan, chain, i);
    if (found === null) {
      i += 1;
      continue;
    }
    const start = i === 0 && chain.plusAt !== null ? chain.plusAt : groups[i].start;
    spans.push([start, groups[found].end]);
    i = found + 1;
  }
  return spans;
}

function longestPhoneFrom(scan: string, chain: { plusAt: number | null; groups: NumberGroup[] }, i: number): number | null {
  const { groups } = chain;
  for (let j = groups.length - 1; j >= i; j--) {
    const part = groups.slice(i, j + 1);
    const digits = part.map((g) => g.digits).join("");
    const solid = part.length === 1 && part[0].written === "digits";
    const hasPlus = i === 0 && chain.plusAt !== null;
    if (!looksLikePhone(digits, hasPlus, solid)) continue;
    if (!phoneShaped(part, hasPlus) && UNIT_AFTER.test(scan.slice(groups[j].end))) continue;
    if (isRoundRange(part)) continue;
    return j;
  }
  return null;
}

/**
 * Номер, после которого единица («тг», «см», «%») не делает его ценой или размером: 10–12 цифр подряд,
 * номер с «+», словами, с кодом «8»/«7» отдельной группой или с окончанием «45 67». Размеры «900 600 2400 мм»
 * и «780 900 2400 мм» так не выглядят — их по-прежнему спасает единица.
 */
function phoneShaped(part: NumberGroup[], hasPlus: boolean): boolean {
  if (hasPlus || part.length === 1 || part.some((g) => g.written === "words")) return true;
  // «(701) 123 4567 см», «701-123-4567 мм»: 10–11 цифр с кодом оператора — номер, какая бы единица ни стояла после.
  if (part.length <= 3 && kzMobileDigits(part.map((g) => g.digits).join(""))) return true;
  const lengths = part.map((g) => g.digits.length);
  return lengths[0] === 1 || (lengths.length >= 3 && lengths.at(-1) === 2 && lengths.at(-2) === 2);
}

/** «70000-800000»: два круглых числа подряд — это вилка цены, а не номер. */
function isRoundRange(part: NumberGroup[]): boolean {
  return part.length === 2 && part.every((g) => g.written === "digits" && g.digits.length >= 4 && g.digits.endsWith("000"));
}

/**
 * Казахстанские и соседние форматы: 11 цифр с 7/8 в начале, 10 цифр без кода страны (7xx — КЗ, 9xx — РФ),
 * с «+» — любой международный номер. 12 цифр подряд — ИИН/БИН или номер без «+».
 */
function looksLikePhone(digits: string, hasPlus: boolean, solid: boolean): boolean {
  const n = digits.length;
  if (hasPlus) return n >= 10 && n <= 13;
  if (n === 11) return /^[78]/.test(digits);
  if (n === 10) return /^[79]/.test(digits);
  if (n === 12) return solid;
  return false;
}

/* ── Сборка результата ─────────────────────────────────────────────────── */

function matchAll(text: string, re: RegExp): Span[] {
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as const);
}

function replaceSpans(text: string, spans: Span[]): string {
  const sorted = [...spans].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (end <= cursor) continue;
    if (start >= cursor) out += text.slice(cursor, start) + MASK;
    cursor = Math.max(cursor, end);
  }
  return out + text.slice(cursor);
}

const ADJACENT_MASKS = new RegExp(`${escapeRegExp(MASK)}(?:[\\s:,;\\-–—]*${escapeRegExp(MASK)})+`, "gu");

function collapseMasks(text: string): string {
  return text.replace(ADJACENT_MASKS, MASK);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
