import type { Segment } from "@/generated/prisma/enums";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import {
  SEGMENTS,
  stepInputSchema,
  WIZARD_SCREENS,
  type PriceHint,
  type RequestDetails,
  type StepFormInput,
  type WizardScreen,
} from "@/modules/requests/client";
import { COUNTERTOPS, FACADES, HARDWARE, POPULAR_FURNITURE_TYPES, SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { to } from "../../../_shell/paths";

// Чистая логика мастера заявки (без React и браузера): адреса шагов, «Назад», разбор полей формы шага в шаг модуля,
// ошибки у полей, начальные значения и сводка. Проверяет её steps.test.ts.

const t = ru.app.requests.wizard;

/** Всего шагов мастера (пять экранов модуля: start → segment → room → place → send). */
export const TOTAL_STEPS = WIZARD_SCREENS.length;

/** Варианты-заглушки выбора типа: «Другое» и «Свой вариант» (не id справочника). */
export const OTHER = "__other";
export const CUSTOM = "__custom";
/** Значение «не знаю» у материалов и «не нужна» у столешницы (как в схеме модуля). */
export const UNKNOWN = "unknown";
export const NO_COUNTERTOP = "none";

/** Адрес мастера: черновик и шаг, а до черновика — работа («Хочу похожее») или номер мастера (прямая заявка). */
export function wizardHref(params: { draft?: string | null; step?: WizardScreen | null; like?: string | null; executor?: number | null } = {}): string {
  const query = new URLSearchParams();
  if (params.draft) query.set("draft", params.draft);
  if (params.step) query.set("step", params.step);
  if (params.like) query.set("like", params.like);
  if (params.executor) query.set("executor", String(params.executor));
  const search = query.toString();
  return search ? `${to("/requests/new")}?${search}` : to("/requests/new");
}

/**
 * Экран после сохранённого (последний — снова последний). Шаги модуля, которые не экраны мастера (их сохраняет только
 * помощник ИИ v1), ведут на первый экран — дальше resumeIndex откроет сохранённый.
 */
export function nextScreen(screen: string): WizardScreen {
  const index = (WIZARD_SCREENS as readonly string[]).indexOf(screen);
  return index < 0 ? WIZARD_SCREENS[0] : WIZARD_SCREENS[Math.min(index + 1, TOTAL_STEPS - 1)];
}

/**
 * «Назад»: с первого шага прямой заявки — в профиль мастера («‹ Исполнитель №N», подпись модуля), обычной — к списку
 * заявок; дальше — на прошлый шаг того же черновика (его ответы сохранены).
 */
export function wizardBack(
  index: number,
  draftId: string | null,
  profile: { publicNumber: number; label: string } | null = null,
): { href: string; label: string } {
  if (index <= 0 || !draftId) {
    return profile ? { href: to(`/executors/${profile.publicNumber}`), label: profile.label } : { href: to("/requests"), label: t.backToList };
  }
  return { href: wizardHref({ draft: draftId, step: WIZARD_SCREENS[index - 1] }), label: t.steps[index - 1] };
}

/** Тексты модуля requests (словари v1: «исполнитель», «шаги мастера») → тексты экрана v2. Прочие — как есть. */
const V2_MESSAGES: ReadonlyMap<string, string> = new Map([
  [ru.requests.validation.addressRequired, t.errors.addressRequired],
  [ru.requests.validation.chooseOrUnknown, t.errors.chooseOrUnknown],
  [ru.requests.errors.targetUnavailable, t.errors.targetUnavailable],
  [ru.requests.errors.selfDeal, t.errors.selfDeal],
  [ru.requests.errors.notDraft, t.errors.notDraft],
  [ru.requests.errors.incomplete, t.errors.incomplete],
]);

export function v2Message(message: string): string {
  return V2_MESSAGES.get(message) ?? message;
}

/** Публичный номер мастера из адреса (`?executor=17`): только целое положительное, иначе `null`. */
export function parseExecutorNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

// ─── разбор формы шага ─────────────────────────────────────────────────────────────────────────────────────────────

/** То, что нужно от FormData (тесты передают её же). */
type Fields = Pick<FormData, "get" | "getAll">;

const text = (fd: Fields, name: string): string => {
  const value = fd.get(name);
  return typeof value === "string" ? value : "";
};

/** Сантиметры из поля: пусто — null; «60,5» → 60.5 (схема модуля потребует целое и скажет об этом у поля). */
const centimeters = (value: string): number | null => (value.trim() === "" ? null : Number(value.trim().replace(",", ".")));

/** Тип мебели: плитка справочника, «Другое» → тип из списка или «Свой вариант» → текст. */
function typeFields(fd: Fields): { furnitureTypeId: string | null; customType: string | null } {
  const main = text(fd, "furnitureType");
  const sub = text(fd, "furnitureTypeOther");
  if (main !== OTHER) return { furnitureTypeId: main || null, customType: null };
  if (sub === CUSTOM) return { furnitureTypeId: null, customType: text(fd, "customType") };
  return { furnitureTypeId: sub || null, customType: null };
}

/** Блок «размеры и материалы»: отправляется, только если его открыли (поле `advanced` = "1"); иначе details не меняются. */
function advancedFields(fd: Fields) {
  if (text(fd, "advanced") !== "1") return null;
  const size =
    text(fd, "sizeMode") === "known"
      ? { mode: "known" as const, widthCm: centimeters(text(fd, "widthCm")), heightCm: centimeters(text(fd, "heightCm")), depthCm: centimeters(text(fd, "depthCm")) }
      : { mode: "unknown" as const };
  return { size, facade: text(fd, "facade") || UNKNOWN, countertop: text(fd, "countertop") || UNKNOWN, hardware: text(fd, "hardware") || UNKNOWN };
}

/** Точка адреса из скрытых полей `lat` / `lng`: обе или ни одной. */
function locationFields(fd: Fields): { lat: number; lng: number } | null {
  const lat = text(fd, "lat");
  const lng = text(fd, "lng");
  return lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
}

/** Поля формы шага → шаг модуля в «сыром» виде (его разбирает stepInputSchema — здесь и в действии на сервере). */
export function readStep(screen: WizardScreen, fd: Fields): StepFormInput {
  switch (screen) {
    case "start":
      return { screen, ...typeFields(fd), style: (text(fd, "style") || null) as StyleKey | null, advanced: advancedFields(fd) } as StepFormInput;
    case "segment":
      return { screen, segment: (text(fd, "segment") || undefined) as Segment } as StepFormInput;
    case "room":
      return { screen, photoFileIds: fd.getAll("photoFileIds").filter((v): v is string => typeof v === "string"), description: text(fd, "description") };
    case "place":
      return { screen, city: text(fd, "city"), district: text(fd, "district") || null, complex: text(fd, "complex") || null, address: text(fd, "address"), desiredDate: text(fd, "desiredDate") || null, location: locationFields(fd) };
    case "send":
      return { screen };
  }
}

/**
 * Ошибки шага по полям (первое сообщение на поле) или `null`, если шаг верен. Ключ — имя поля формы: последний элемент
 * пути (`advanced.size.widthCm` → `widthCm`), точка адреса — `location`, ошибка без поля — `form`.
 */
export function stepErrors(screen: WizardScreen, fd: Fields, now: number = Date.now()): Record<string, string> | null {
  const parsed = stepInputSchema.safeParse(readStep(screen, fd));
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const names = issue.path.filter((p): p is string => typeof p === "string");
      const key = names.includes("location") ? "location" : (names.at(-1) ?? "form");
      errors[key] ??= v2Message(issue.message);
    }
  }
  // Желаемая дата — не раньше сегодняшней (Астана); схема модуля проверяет только формат даты.
  const date = screen === "place" ? text(fd, "desiredDate") : "";
  if (date !== "" && date < todayAstana(now)) errors.desiredDate ??= ru.app.requests.wizard.place.datePast;
  return Object.keys(errors).length > 0 ? errors : null;
}

/** Часовой пояс Казахстана (Астана и Алматы) — UTC+5 без перехода на летнее время. */
const ASTANA_OFFSET_MS = 5 * 3_600_000;

/** Сегодняшняя дата в Астане («2026-11-16»): нижняя граница желаемой даты заявки. */
export function todayAstana(now: number = Date.now()): string {
  return new Date(now + ASTANA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Дата через `days` дней от `from` («2026-11-16» → «2026-12-16»): быстрые сроки заявки. */
export function addDays(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

// ─── начальные значения ────────────────────────────────────────────────────────────────────────────────────────────

export type FurnitureType = { id: string; slug: string; name: string };

/** Плитки частых заказов (по порядку `POPULAR_FURNITURE_TYPES`) и остальные типы справочника для «Другое». */
export function splitTypes(types: readonly FurnitureType[]): { popular: FurnitureType[]; rest: FurnitureType[] } {
  const popular = POPULAR_FURNITURE_TYPES.flatMap((slug) => types.filter((type) => type.slug === slug));
  return { popular, rest: types.filter((type) => !popular.includes(type)) };
}

/** Выбор типа из черновика: плитка, «Другое» + тип из списка или «Другое» + свой вариант. */
export function typeChoice(types: readonly FurnitureType[], saved: { furnitureTypeId: string | null; customType: string | null }) {
  const { popular } = splitTypes(types);
  if (saved.furnitureTypeId && popular.some((type) => type.id === saved.furnitureTypeId)) return { main: saved.furnitureTypeId, sub: "", custom: "" };
  if (saved.furnitureTypeId) return { main: OTHER, sub: saved.furnitureTypeId, custom: "" };
  if (saved.customType) return { main: OTHER, sub: CUSTOM, custom: saved.customType };
  return { main: "", sub: "", custom: "" };
}

export type AdvancedState = { open: boolean; sizeKnown: boolean; width: string; height: string; depth: string; facade: string; countertop: string; hardware: string };

/** Размеры и материалы из черновика; блок открыт сразу, если там что-то указано (сохранённое не прячется). */
export function advancedFrom(d: RequestDetails): AdvancedState {
  const unknown = new Set(d.unknown ?? []);
  const state = {
    sizeKnown: Boolean(d.widthCm),
    width: d.widthCm?.toString() ?? "",
    height: d.heightCm?.toString() ?? "",
    depth: d.depthCm?.toString() ?? "",
    facade: d.facade ?? UNKNOWN,
    // Столешница не выбрана и не помечена «не знаю» при указанных фасадах — значит, не нужна (как в v1).
    countertop: d.countertop ?? (unknown.has("countertop") || !d.facade ? UNKNOWN : NO_COUNTERTOP),
    hardware: d.hardware ?? UNKNOWN,
  };
  return { ...state, open: state.sizeKnown || unknown.size > 0 || d.facade !== undefined || d.countertop !== undefined || d.hardware !== undefined };
}

/** Варианты справочника материалов для списка: «не знаю» первым. */
export function materialOptions(book: Readonly<Record<string, { name: string }>>): { value: string; label: string }[] {
  return [{ value: UNKNOWN, label: t.unknown }, ...Object.entries(book).map(([value, o]) => ({ value, label: o.name }))];
}

export const STYLE_OPTIONS: { value: string; label: string }[] = Object.entries(STYLES).map(([value, s]) => ({ value, label: t.start.styleOption(s.name, s.hint) }));
export const FACADE_OPTIONS = materialOptions(FACADES);
export const COUNTERTOP_OPTIONS = [...materialOptions(COUNTERTOPS), { value: NO_COUNTERTOP, label: t.start.noCountertop }];
export const HARDWARE_OPTIONS = materialOptions(HARDWARE);

// ─── уровень ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Целые тенге подсказки цены → строка суммы (`formatMoney` берёт тиыны). */
const kzt = (value: number): string => formatMoney(BigInt(Math.round(value)) * 100n);

/**
 * Варианты уровня: название, что это значит и строка цены. Цена — только по настоящим предложениям мастеров (`offers`):
 * подсказка по материалам — возможность за флагом `materialsCalculator`, в v2 её нет (Фаза 1), уровень показывается без вилки.
 */
export function segmentOptions(prices: Readonly<Record<Segment, PriceHint | null>>): { value: Segment; label: string; description: string }[] {
  const s = t.segment;
  return SEGMENTS.map((segment) => {
    const hint = prices[segment];
    const price = hint?.source === "offers" ? s.price(kzt(hint.from), kzt(hint.to)) : s.noPrice;
    return { value: segment, label: SEGMENT_NAMES[segment], description: `${ru.requests.wizard.segment.explain[segment]}. ${price}` };
  });
}

/** Пояснение под вариантами: по скольким предложениям вилки; без вилок — `null`. */
export function segmentPriceNote(prices: Readonly<Record<Segment, PriceHint | null>>): string | null {
  const offers = SEGMENTS.reduce((n, segment) => {
    const hint = prices[segment];
    return n + (hint?.source === "offers" ? hint.count : 0);
  }, 0);
  return offers > 0 ? t.segment.priceNote(offers) : null;
}

// ─── сводка ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** То, что сводке нужно от черновика (подмножество `Draft` модуля). */
export type SummaryDraft = {
  id: string;
  title: string;
  style: string | null;
  details: RequestDetails;
  segment: Segment | null;
  photos: readonly { id: string; src: string }[];
  city: string;
  district: string | null;
  complex: string | null;
  address: string | null;
  desiredDate: Date | null;
};

export type SummaryRow = { label: string; value: string; href: string };

/** Строки сводки последнего шага: каждая ведёт на шаг, где её поменять. Материалы — только указанные. */
export function summaryRows(draft: SummaryDraft): SummaryRow[] {
  const s = t.send;
  const d = draft.details;
  const at = (screen: WizardScreen) => wizardHref({ draft: draft.id, step: screen });
  const style = draft.style && draft.style in STYLES ? STYLES[draft.style as StyleKey].name : t.start.styleAny;
  const rows: (SummaryRow | null)[] = [
    { label: s.type, value: draft.title, href: at("start") },
    { label: s.style, value: style, href: at("start") },
    { label: s.size, value: d.widthCm ? s.sizeValue(d.widthCm, d.heightCm, d.depthCm) : t.start.sizeUnknown, href: at("start") },
    d.facade ? { label: s.facade, value: FACADES[d.facade].name, href: at("start") } : null,
    d.countertop ? { label: s.countertop, value: COUNTERTOPS[d.countertop].name, href: at("start") } : null,
    d.hardware ? { label: s.hardware, value: HARDWARE[d.hardware].name, href: at("start") } : null,
    { label: s.segment, value: draft.segment ? SEGMENT_NAMES[draft.segment] : s.notSet, href: at("segment") },
    { label: s.photos, value: draft.photos.length > 0 ? s.photosCount(draft.photos.length) : s.noPhotos, href: at("room") },
    d.description ? { label: s.description, value: d.description, href: at("room") } : null,
    { label: s.address, value: [draft.city, draft.district, draft.complex, draft.address].filter(Boolean).join(", ") || s.notSet, href: at("place") },
    { label: s.date, value: draft.desiredDate ? formatDate(draft.desiredDate) : s.notSet, href: at("place") },
  ];
  return rows.filter((row): row is SummaryRow => row !== null);
}

/** Сноска под сводкой: кто увидит заявку. */
export function sendFootnote(segment: Segment | null, direct: string | null): string {
  if (direct !== null) return t.send.footnoteDirect(direct);
  return segment ? t.send.footnote(SEGMENT_NAMES[segment]) : "";
}
