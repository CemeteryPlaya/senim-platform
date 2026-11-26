import { ru } from "@/i18n/ru";
import type { HighlightCard, PublicExecutorPage, PublicExecutorView } from "@/modules/companies";
import type { DealHistoryItem, ExecutorStats } from "@/modules/deal-core";
import { to } from "../../../../_shell/paths";
import { isUploadedSrc, toTiyn, workCardView, workGallery, type WorkCardView, type WorkPhoto } from "../../../_parts/work-card";

const t = ru.app.guest.executor;

/**
 * Данные страницы: часть companies (представление, «О себе», «Лучшие работы», «Работы вне площадки») и часть deal-core
 * (числа сделок и «Сделки на площадке» с отзывами) — companies не импортирует deal-core, страница собирает их сама.
 */
export type ExecutorPageData = PublicExecutorPage & { stats: ExecutorStats; dealHistory: DealHistoryItem[] };

/** Число шапки: значение крупно, подпись под ним; `muted` — данных нет (прочерк или ноль). */
export type StatView = { value: string; label: string; muted?: true };

/** Строка карточки «Условия». `layout` задан явно: `inline` — значение справа от подписи, `stacked` — под ней. */
export type ConditionRow = {
  label: string;
  value: string;
  /** Плата за выезд, тиыны: показывается через `Money` перед `value`. */
  feeTiyn?: bigint;
  note?: string;
  layout: "inline" | "stacked";
};

export type HighlightView = { id: string; title: string; meta: string; photo?: { src: string; alt: string } };

/** Отзыв внизу своей сделки; `signature` нет — покупатель без подписи. */
export type DealReviewView = { ratingLabel: string; text: string; signature?: string };

/**
 * Карточка сделки на площадке. Фото, стоимость и место — только если их отдал модуль (выбор покупателя): поля нет —
 * не показываем.
 */
export type DealView = {
  id: string;
  title: string;
  /** «Комфорт · октябрь 2026». */
  meta: string;
  outcome: { label: string; tone: "accent" | "neutral" };
  photos: WorkPhoto[];
  priceTiyn?: bigint;
  place?: string;
  review?: DealReviewView;
};

export type OffPlatformWork = WorkCardView;
export type ExplainView = { label: string; title: string; paragraphs: readonly string[] };

export type ExecutorViewModel = {
  title: string;
  /** Монограмма у заголовка — только у открытого имени (ADR-006): у «Исполнитель №N» она повторяла бы номер. */
  monogram: boolean;
  backHref: string;
  /** Шапка: рейтинг (подпись — число отзывов), «Сделок», «Успешных». */
  stats: StatView[];
  conditions: ConditionRow[];
  /** Абзацы «О мастере»; пусто — мастер ничего не написал. */
  about: string[];
  /** Пусто — раздела нет. */
  highlights: HighlightView[];
  /** Пусто — раздел с текстом «Оконченных сделок пока нет». */
  deals: DealView[];
  /** Пусто — раздела нет. `gallery` — снимки работ для мозаики (обложки первыми). */
  offPlatform: { works: OffPlatformWork[]; gallery: WorkPhoto[] };
  explain: ExplainView;
  /** Заявка этому мастеру (для экрана заявки следующего этапа: `executor` — публичный номер). У любого мастера. */
  action: { href: string; label: string };
};

/** Публичный номер из адреса: только цифры, без нуля впереди, до 9 знаков. Иначе — `null` (страницы нет). */
export function parsePublicNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return null;
  return Number(raw);
}

const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Almaty" });

/** «октябрь 2026» — без «г.», по времени Алматы. */
function monthOf(date: Date): string {
  const parts = monthFormat.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")} ${part("year")}`;
}

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
  if (view.yearsExperience > 0) rows.push({ label: t.rows.experience, value: t.years(view.yearsExperience), layout: "inline" });
  return rows;
}

function statsOf(view: PublicExecutorView, stats: ExecutorStats): StatView[] {
  const rating: StatView =
    view.reviewsCount > 0
      ? { value: view.ratingAvg.toFixed(1).replace(".", ","), label: ru.app.guest.catalog.reviews(view.reviewsCount) }
      : { value: t.emptyValue, label: ru.app.kit.rating.none, muted: true };
  const deals: StatView = { value: String(stats.deals), label: t.stats.deals, ...(stats.deals === 0 ? { muted: true as const } : {}) };
  const success: StatView =
    stats.successRate === null
      ? { value: t.emptyValue, label: t.stats.successNone, muted: true }
      : { value: t.stats.percent(stats.successRate), label: t.stats.success };
  return [rating, deals, success];
}

function highlightView(card: HighlightCard): HighlightView {
  const photo = card.photo && isUploadedSrc(card.photo.src) ? { photo: card.photo } : {};
  return { id: card.id, title: card.title, meta: t.highlightKind[card.kind], ...photo };
}

/** Отзыв — как отдал модуль (текст уже очищен маской, подпись — по выбору покупателя); пустая подпись — без подписи. */
function reviewView(review: NonNullable<DealHistoryItem["review"]>): DealReviewView {
  const signedAs = review.signedAs.trim();
  return { ratingLabel: t.reviewRating(review.rating), text: review.text.trim(), ...(signedAs ? { signature: t.reviewSignature(signedAs) } : {}) };
}

function dealView(item: DealHistoryItem): DealView {
  return {
    id: item.id,
    title: item.title,
    meta: [item.segment ? t.segments[item.segment] : null, monthOf(item.endedAt)].filter(Boolean).join(" · "),
    outcome: item.outcome === "success" ? { label: t.outcome.success, tone: "accent" } : { label: t.outcome.failed, tone: "neutral" },
    photos: item.photos.map((p) => ({ src: p.src, alt: p.alt, caption: item.title })),
    ...(item.priceTiyn !== null ? { priceTiyn: item.priceTiyn } : {}),
    ...(item.place !== null ? { place: item.place } : {}),
    ...(item.review ? { review: reviewView(item.review) } : {}),
  };
}

/**
 * Чистая view-модель профиля мастера: шапка с числами, условия, «О мастере», «Лучшие работы», «Сделки на площадке»
 * (отзыв — внизу своей сделки), «Работы вне площадки», пояснение и действие. Без ввода-вывода. Берёт ровно то, что
 * отдали модули (`toPublicView`, маски, выбор покупателя уже применены): телефона, Instagram, наименования в режиме
 * HIDDEN, ИИН/БИН и того, что покупатель не разрешил показать, здесь нет и взять неоткуда.
 */
export function executorView(page: ExecutorPageData, opts: { requestId?: string | null } = {}): ExecutorViewModel {
  const { view } = page;
  return {
    title: view.label,
    monogram: view.nameShown,
    // «Назад» — в список мастеров, откуда пришли (с тем же заказом в адресе, если он был).
    backHref: opts.requestId ? `${to("/executors")}?${new URLSearchParams({ request: opts.requestId })}` : to("/executors"),
    stats: statsOf(view, page.stats),
    conditions: conditionRows(view),
    about: page.about
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    highlights: page.highlights.map(highlightView),
    deals: page.dealHistory.map(dealView),
    offPlatform: {
      works: page.offPlatform.map(workCardView),
      gallery: workGallery(page.offPlatform),
    },
    explain: view.nameShown ? t.explain.shown : t.explain.hidden,
    action: { href: `${to("/requests/new")}?${new URLSearchParams({ executor: String(view.publicNumber) }).toString()}`, label: t.action },
  };
}
