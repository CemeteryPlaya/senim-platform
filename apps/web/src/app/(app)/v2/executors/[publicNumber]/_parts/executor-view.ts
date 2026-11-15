import { ru } from "@/i18n/ru";
import type { PublicExecutorPage, PublicExecutorView } from "@/modules/companies";
import { to } from "../../../../_shell/paths";
import { toTiyn, workCardView, workGallery, type WorkCardView, type WorkPhoto } from "../../../_parts/work-card";

const t = ru.app.guest.executor;

/** Факт строки-сводки: `before` и `after` — серые пояснения, `value` — тёмное значение; `plain` — вся строка серая (без значения). */
export type Fact = { before?: string; value: string; after?: string; plain?: true };

/** Строка карточки «Условия». `layout` задан явно: `inline` — значение справа от подписи, `stacked` — под ней. */
export type ConditionRow = {
  label: string;
  value: string;
  /** Плата за выезд, тиыны: показывается через `Money` перед `value`. */
  feeTiyn?: bigint;
  note?: string;
  layout: "inline" | "stacked";
};

export type ReviewView = { id: string; ratingLabel: string; date: string; text: string };
export type ExplainView = { label: string; title: string; paragraphs: readonly string[] };

export type ExecutorViewModel = {
  title: string;
  backHref: string;
  /** Рейтинг: 1…5; `null` — отзывов нет. */
  rating: { value: number | null; count: number };
  /** Сделки в сервисе и стаж (стаж 0 — не указан, факта нет). */
  facts: Fact[];
  conditions: ConditionRow[];
  /** Абзацы «О мастере»; пусто — мастер ничего не написал. */
  about: string[];
  works: WorkCardView[];
  /** Снимки работ для мозаики и галереи (обложки работ первыми); пусто — фото нет, мозаики нет. */
  gallery: WorkPhoto[];
  reviews: ReviewView[];
  explain: ExplainView;
  /** Заявка этому мастеру (для экрана заявки следующего этапа: `executor` — публичный номер). У любого мастера. */
  action: { href: string; label: string };
};

/** Публичный номер из адреса: только цифры, без нуля впереди, до 9 знаков. Иначе — `null` (страницы нет). */
export function parsePublicNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return null;
  return Number(raw);
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" });

function measurementRow(view: PublicExecutorView): ConditionRow {
  const label = t.rows.measurement;
  const m = t.measurement;
  if (view.measurementTerms === "FREE") return { label, value: m.FREE, layout: "inline" };
  if (view.measurementTerms === "INCLUDED") return { label, value: m.INCLUDED, layout: "stacked" };
  const fee = view.measurementFee;
  if (fee !== null && fee > 0) return { label, feeTiyn: toTiyn(fee), value: m.feeSuffix, note: m.feeNote, layout: "stacked" };
  return { label, value: m.feeUnknown, note: m.feeNote, layout: "stacked" };
}

function conditionRows(view: PublicExecutorView): ConditionRow[] {
  const rows: ConditionRow[] = [];
  if (view.specializations.length > 0) {
    rows.push({ label: t.rows.specializations, value: view.specializations.map((s) => s.name).join(", "), layout: "stacked" });
  }
  rows.push(measurementRow(view));
  if (view.address.trim()) rows.push({ label: t.rows.address, value: view.address.trim(), layout: "stacked" });
  return rows;
}

function facts(view: PublicExecutorView): Fact[] {
  const result: Fact[] = [t.facts.deals(view.completedDeals)];
  if (view.yearsExperience > 0) result.push(t.facts.years(view.yearsExperience));
  return result;
}

/**
 * Чистая view-модель профиля мастера: из ответа `getPublicExecutorPage` — строка-сводка, условия, «О мастере», работы,
 * отзывы, пояснение и действие. Без ввода-вывода. Берёт ровно то, что отдал модуль (`toPublicView`, `maskContacts`,
 * `maskIdentity` уже применены): телефона, Instagram, наименования в режиме HIDDEN и ИИН/БИН здесь нет и взять неоткуда.
 */
export function executorView(page: PublicExecutorPage): ExecutorViewModel {
  const { view } = page;
  const works = page.portfolio.map(workCardView);
  return {
    title: view.label,
    backHref: to("/catalog"),
    rating: { value: view.reviewsCount > 0 ? view.ratingAvg : null, count: view.reviewsCount },
    facts: facts(view),
    conditions: conditionRows(view),
    about: page.about
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    works,
    gallery: workGallery(page.portfolio),
    reviews: page.reviews.map((r) => ({ id: r.id, ratingLabel: t.reviewRating(r.rating), date: dateFormat.format(r.createdAt), text: r.text.trim() })),
    explain: view.nameShown ? t.explain.shown : t.explain.hidden,
    action: { href: `${to("/requests/new")}?${new URLSearchParams({ executor: String(view.publicNumber) }).toString()}`, label: t.action },
  };
}
