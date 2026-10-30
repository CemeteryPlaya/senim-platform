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

export function maskContacts(text: string): MaskResult {
  const spans = [...findEmails(text), ...findLinks(text), ...findNicks(text), ...findMessengers(text), ...findPhones(text)];
  if (spans.length === 0) return { text, masked: false };
  return { text: collapseMasks(replaceSpans(text, spans)), masked: true };
}

/**
 * Скрывает наименование или ФИО исполнителя в его публичных текстах («о себе», портфолио).
 * Форма (ТОО, ИП) и кавычки отбрасываются; слишком короткое имя не ищем — будет ложное срабатывание.
 */
export function maskIdentity(text: string, legalName: string): string {
  const core = legalName
    .replace(/(?<!\p{L})(?:ТОО|ИП|АО|ЧП|LLP|TOO)(?!\p{L})/gu, " ")
    .replace(/[«»"“”„']/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (core.join(" ").length < 4) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${core.map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(pattern, MASK);
}

/* ── Детекторы ─────────────────────────────────────────────────────────── */

const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;
// Обход маски словами: «ivan собака gmail точка com», «ivan (at) mail (dot) ru».
const EMAIL_SPELLED = new RegExp(
  `${NOT_WORD_BEFORE}[a-z0-9._%+-]+\\s*(?:\\(at\\)|\\[at\\]|\\sat\\s|собака)\\s*[a-z0-9-]+\\s*(?:\\.|\\(dot\\)|\\[dot\\]|\\sdot\\s|точка)\\s*[a-z]{2,}${NOT_WORD_AFTER}`,
  "giu",
);

function findEmails(text: string): Span[] {
  return [...matchAll(text, EMAIL), ...matchAll(text, EMAIL_SPELLED)];
}

const TLD = "com|kz|ru|me|org|net|io|app|ly|link|info|biz|site|online|shop|store|uz|kg|by|ua|su|pro|gl|co|cc|tv|рф|қаз";
const URL_WITH_SCHEME = /(?:https?:\/\/|www\.)[^\s<>"«»]+/giu;
const BARE_DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}@._-])(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?\\.)+(?:${TLD})(?![\\p{L}\\p{N}-])(?:\\/[^\\s<>"«»]*)?`,
  "giu",
);
const TRAILING_PUNCTUATION = /[.,!?;:)»"']+$/u;

function findLinks(text: string): Span[] {
  return [...matchAll(text, URL_WITH_SCHEME), ...matchAll(text, BARE_DOMAIN)].map(([start, end]) => {
    const tail = TRAILING_PUNCTUATION.exec(text.slice(start, end));
    return [start, end - (tail?.[0].length ?? 0)] as const;
  });
}

const NICK = /(?<![\p{L}\p{N}_.@])@[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])+/giu;

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
];
// Латинский ник сразу после мессенджера («инст mebel_astana», «Telegram: mebel.astana») — тоже контакт.
const HANDLE_AFTER = "(?:\\s*[:\\-–—]?\\s*@?[a-z0-9_.]{2,}[a-z0-9_])?";
const MESSENGER = new RegExp(`${NOT_WORD_BEFORE}(?:${MESSENGER_WORDS.join("|")})${HANDLE_AFTER}${NOT_WORD_AFTER}`, "giu");

function findMessengers(text: string): Span[] {
  return matchAll(text, MESSENGER);
}

/* ── Телефоны ──────────────────────────────────────────────────────────── */

// Что заведомо не телефон: даты, суммы с разделителями тысяч (и их диапазоны), номера документов.
const AMOUNT = "\\d{1,3}(?:[ \\u00A0\\u202F]\\d{3})+";
const PROTECTED = [
  /(?<![\d.])(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[0-2])[./](?:\d{4}|\d{2})(?!\d)/gu,
  /(?<!\d)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)/gu,
  // Сумма «1 350 000» или диапазон «700 000 – 1 000 000», за которой не идут ещё цифры (иначе это телефон «8 700 123 45 67»).
  new RegExp(`(?<![\\d+])(?<!\\d[\\s\\-–—().])${AMOUNT}(?:\\s*[-–—]\\s*${AMOUNT})?(?![\\s\\-–—().]{0,3}\\d)`, "gu"),
  /[№#]\s*\d+/gu,
];
const PROTECTED_CHAR = "";

// После числа — валюта или единица измерения: это цена или размер.
const UNIT_AFTER = /^[\s ]*(?:₸|тг|тенге|kzt|руб|р\.|₽|\$|usd|долл|eur|€|тыс|млн|млрд|мм|см|м(?!\p{L})|метр|кг|шт|%)/iu;
const GAP = /^[\s\-–—().]{0,3}$/u;
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
};
const PLUS_WORD = "плюс";

/** Число в цепочке: «87001234567», «семьсот один» (одна группа из нескольких слов) или «45». */
type NumberGroup = { start: number; end: number; digits: string; written: "digits" | "words" };
type Token = { start: number; end: number; text: string };

function findPhones(text: string): Span[] {
  const scan = protect(text);
  const spans: Span[] = [];
  for (const chain of numberChains(scan)) spans.push(...phonesInChain(scan, chain));
  return spans;
}

/** Закрывает даты, суммы и номера документов символом той же длины: позиции совпадают с исходным текстом. */
function protect(text: string): string {
  let scan = text;
  for (const re of PROTECTED) {
    scan = scan.replace(re, (m) => PROTECTED_CHAR.repeat(m.length));
  }
  return scan;
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
    const isNumber = /^\d+$/.test(token.text) || token.text in NUMBER_WORDS;
    const last = tokens.at(-1);
    if (last && !GAP.test(scan.slice(last.end, token.start))) flush();
    if (token.text === PLUS_WORD) {
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

  for (const token of tokens) {
    const word = NUMBER_WORDS[token.text];
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
    if (!looksLikePhone(digits, i === 0 && chain.plusAt !== null, solid)) continue;
    if (UNIT_AFTER.test(scan.slice(groups[j].end))) continue;
    if (isRoundRange(part)) continue;
    return j;
  }
  return null;
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
