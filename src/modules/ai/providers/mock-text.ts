import type { CountertopKey, FacadeKey, HardwareKey, StyleKey } from "@/verticals/furniture";
import { SIZE_MAX_CM, SIZE_MIN_CM, WISHES_MAX, type DetailUnknown, type RequestDraftSuggestion } from "../schema";

/**
 * Детерминированный разбор текста заказчика по ключевым словам — «ИИ» мок-провайдера.
 * Ничего не угадывает: что не нашлось по словарю, остаётся null.
 */

type Rule<T> = readonly [RegExp, T];
const W = "(?<![\\p{L}])"; // начало слова (\b не работает с кириллицей)
const rx = (source: string) => new RegExp(source, "iu");

function firstMatch<T>(text: string, rules: readonly Rule<T>[]): T | null {
  for (const [pattern, value] of rules) if (pattern.test(text)) return value;
  return null;
}

// Порядок важен: первое совпадение побеждает.
const FURNITURE: readonly Rule<string>[] = [
  [rx(`${W}(?:шкаф[\\s-]*купе|купе)`), "wardrobe"],
  [rx(`${W}гардеробн`), "walk-in-closet"],
  [rx(`${W}кух(?:н|он)`), "kitchen"],
  [rx(`${W}прихож`), "hallway"],
  [rx(`${W}детск`), "kids-room"],
  [rx(`${W}спальн`), "bedroom"],
  [rx(`${W}(?:гостин|тв[\\s-]*зон|под\\s+телевизор)`), "living-room"],
  [rx(`${W}ванн`), "bathroom"],
  [rx(`${W}кабинет`), "office"],
  [rx(`${W}стеллаж`), "shelving"],
  [rx(`${W}(?:комод|тумб)`), "dresser"],
  [rx(`${W}стол(?!еш)`), "table"],
  [rx(`${W}шкаф`), "wardrobe"],
];

const STYLE: readonly Rule<StyleKey>[] = [
  [rx(`${W}неокласс`), "neoclassic"],
  [rx(`${W}класси`), "classic"],
  [rx(`${W}(?:современ|модерн)`), "modern"],
  [rx(`${W}минимал`), "minimalism"],
  [rx(`${W}сканди`), "scandi"],
  [rx(`${W}лофт`), "loft"],
];

const COUNTERTOP: readonly Rule<CountertopKey>[] = [
  [rx(`(?:искусственн|акрилов)\\p{L}*\\s+камн|${W}камень`), "artificial_stone"],
  [rx(`${W}кварц`), "quartz"],
  [rx(`${W}компакт`), "compact"],
  [rx(`${W}лдсп`), "ldsp"],
];

const FACADE: readonly Rule<FacadeKey>[] = [
  [rx(`${W}эмал`), "mdf_enamel"],
  [rx(`${W}мдф`), "mdf_film"],
  [rx(`${W}(?:пл[её]нк|пленоч)`), "mdf_film"],
  [rx(`${W}акрил`), "acrylic"],
  [rx(`${W}шпон`), "veneer"],
  [rx(`${W}массив`), "solid_wood"],
  [rx(`${W}лдсп`), "ldsp"],
];

const HARDWARE: readonly Rule<HardwareKey>[] = [
  [rx(`blum|hettich|${W}(?:блюм|хеттих|премиальн\\p{L}*\\s+фурнитур)`), "premium"],
  [rx(`${W}(?:доводчик|плавн)`), "soft_close"],
  [rx(`${W}(?:обычн|стандартн|прост)\\p{L}*\\s+фурнитур`), "standard"],
];

const COLORS: readonly Rule<string>[] = [
  [rx(`${W}бел(?:ый|ая|ое|ые|ого|ом|ым)`), "белый"],
  [rx(`${W}ч[её]рн(?:ый|ая|ое|ые|ого|ом|ым)`), "чёрный"],
  [rx(`${W}сер(?:ый|ая|ое|ые|ого|ом|ым)`), "серый"],
  [rx(`${W}графит`), "графит"],
  [rx(`${W}бежев`), "бежевый"],
  [rx(`${W}зел[её]н`), "зелёный"],
  [rx(`${W}шалфе`), "шалфей"],
  [rx(`${W}голуб`), "голубой"],
  [rx(`${W}син(?:ий|яя|ее|ие|его|им)`), "синий"],
  [rx(`${W}молочн`), "молочный"],
  [rx(`${W}терракот`), "терракота"],
  [rx(`${W}дуб`), "дуб"],
  [rx(`${W}орех`), "орех"],
  [rx(`${W}венге`), "венге"],
];

/** Все цвета по порядку появления в тексте: «Белый, дуб». */
function colorOf(text: string): string | null {
  const found = COLORS.map(([pattern, name]) => ({ name, at: text.search(pattern) }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((c) => c.name);
  if (found.length === 0) return null;
  const joined = found.join(", ");
  return joined[0].toUpperCase() + joined.slice(1);
}

// ─── размеры ────────────────────────────────────────────────────────────────

const NUM = "(\\d+(?:[.,]\\d+)?)";
const UNIT = "(мм|миллиметр\\p{L}*|см|сантиметр\\p{L}*|метр\\p{L}*|м)(?![\\p{L}])";

/** Перевод в сантиметры; без единицы — по величине: до 10 — метры, от 1000 — миллиметры. */
function toCm(value: string, unit: string | undefined): number | null {
  const n = Number(value.replace(",", "."));
  const u = unit?.toLowerCase() ?? "";
  let cm: number;
  if (u.startsWith("мм") || u.startsWith("милли")) cm = n / 10;
  else if (u.startsWith("см") || u.startsWith("санти")) cm = n;
  else if (u.startsWith("м")) cm = n * 100;
  else cm = n < 10 ? n * 100 : n >= 1000 ? n / 10 : n;
  const rounded = Math.round(cm);
  return rounded >= SIZE_MIN_CM && rounded <= SIZE_MAX_CM ? rounded : null;
}

type Sizes = { widthCm: number | null; heightCm: number | null; depthCm: number | null };
type Axis = keyof Sizes;

const AXIS_WORD: readonly Rule<Axis>[] = [
  [rx("^(?:ширин|длин)"), "widthCm"],
  [rx("^высот"), "heightCm"],
  [rx("^глубин"), "depthCm"],
];

const TRIPLE = rx(`${NUM}\\s*[xх×*]\\s*${NUM}(?:\\s*[xх×*]\\s*${NUM})?\\s*(?:${UNIT})?`);
const LABEL_FIRST = new RegExp(`${W}(ширин|длин|высот|глубин)\\p{L}*[^\\d.;,]{0,20}?${NUM}\\s*(?:${UNIT})?`, "giu");
const VALUE_FIRST = new RegExp(`${NUM}\\s*(?:${UNIT})?\\s*(?:в\\s+)?(ширин|длин|высот|глубин)\\p{L}*`, "giu");
const MEASURE = new RegExp(`${NUM}\\s*${UNIT}`, "giu");

function sizesOf(text: string): Sizes {
  const sizes: Sizes = { widthCm: null, heightCm: null, depthCm: null };
  const triple = TRIPLE.exec(text);
  if (triple) {
    const [, w, h, d, unit] = triple;
    return { widthCm: toCm(w, unit), heightCm: toCm(h, unit), depthCm: d ? toCm(d, unit) : null };
  }
  const set = (word: string, value: string, unit: string | undefined) => {
    const axis = firstMatch(word, AXIS_WORD);
    if (axis && sizes[axis] === null) sizes[axis] = toCm(value, unit);
  };
  for (const m of text.matchAll(LABEL_FIRST)) set(m[1], m[2], m[3]);
  for (const m of text.matchAll(VALUE_FIRST)) set(m[3], m[1], m[2]);
  if (sizes.widthCm === null && sizes.heightCm === null && sizes.depthCm === null) {
    const first = MEASURE.exec(text);
    MEASURE.lastIndex = 0;
    if (first) sizes.widthCm = toCm(first[1], first[2]);
  }
  return sizes;
}

// ─── «не знаю» ──────────────────────────────────────────────────────────────

const UNSURE = "(?:не\\s+знаю|не\\s+уверен\\p{L}*|подскаж\\p{L}*|посовету\\p{L}*)";
const near = (topic: string) => rx(`${topic}[^.;]{0,20}${UNSURE}|${UNSURE}[^.;]{0,20}${topic}`);
const SIZE_UNSURE = near("размер");
const MATERIAL_UNSURE = near("материал");

function unknownOf(text: string, s: { furnitureTypeSlug: string | null }): DetailUnknown[] {
  const unknown: DetailUnknown[] = [];
  if (SIZE_UNSURE.test(text)) unknown.push("size");
  if (MATERIAL_UNSURE.test(text)) {
    unknown.push("facade");
    if (s.furnitureTypeSlug === "kitchen" || s.furnitureTypeSlug === "bathroom") unknown.push("countertop");
    unknown.push("hardware");
  }
  return unknown;
}

// ─── сборка ────────────────────────────────────────────────────────────────

const COUNTERTOP_CLAUSE = rx(`${W}столешниц[^.;,]*`);

export function parseRequestText(text: string, furnitureSlugs: readonly string[]): RequestDraftSuggestion {
  const clause = COUNTERTOP_CLAUSE.exec(text)?.[0] ?? "";
  const withoutCountertop = clause ? text.replace(clause, " ") : text;
  const slug = firstMatch(text, FURNITURE);
  const furnitureTypeSlug = slug && furnitureSlugs.includes(slug) ? slug : null;
  return {
    furnitureTypeSlug,
    customType: null,
    style: firstMatch(text, STYLE),
    ...sizesOf(text),
    facade: firstMatch(withoutCountertop, FACADE),
    countertop: clause ? firstMatch(clause, COUNTERTOP) : firstMatch(text, COUNTERTOP.slice(0, 2)),
    hardware: firstMatch(text, HARDWARE),
    color: colorOf(text),
    unknown: unknownOf(text, { furnitureTypeSlug }),
    wishes: text.trim().slice(0, WISHES_MAX),
  };
}
