import { ru } from "@/i18n/ru";
import type { PublicExecutorPage, PublicExecutorView } from "@/modules/companies";
import { to } from "../../../../_shell/paths";
import { toTiyn, workCardView, type WorkCardView } from "../../../_parts/work-card";

const t = ru.app.guest.executor;

/** Строка сводки: подпись и значение. Рейтинг и сумма рисуются компонентами kit, поэтому у них свои виды. */
export type SummaryRow =
  /** `stacked`: значение длинное — подпись над ним, а не в одну строку с ним. */
  | { kind: "rating"; label: string; /** 1…5; `null` — отзывов нет. */ value: number | null; count: number }
  | { kind: "text"; label: string; value: string; note?: string; stacked: boolean }
  /** Плата за выезд: сумма (тиыны) идёт через `Money`, затем `value`. */
  | { kind: "fee"; label: string; feeTiyn: bigint; value: string; note: string; stacked: true };

export type WorkView = WorkCardView & { href: string };
export type ReviewView = { id: string; ratingLabel: string; date: string; text: string };
export type ExplainView = { label: string; title: string; paragraphs: readonly string[] };

export type ExecutorViewModel = {
  title: string;
  backHref: string;
  rows: SummaryRow[];
  /** Абзацы «О мастере»; пусто — мастер ничего не написал. */
  about: string[];
  works: WorkView[];
  reviews: ReviewView[];
  explain: ExplainView;
  /** Заявка этому мастеру; без работы, по которой её можно создать, действия нет. */
  action: { href: string; label: string } | null;
};

/** Публичный номер из адреса: только цифры, без нуля впереди, до 9 знаков. Иначе — `null` (страницы нет). */
export function parsePublicNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,8}$/.test(raw)) return null;
  return Number(raw);
}

/** Прямая заявка: `like` — работа мастера (так старый экран заявки находит исполнителя). */
const requestHref = (workId: string): string => `${to("/requests/new")}?${new URLSearchParams({ like: workId }).toString()}`;

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" });

/** Короткое значение стоит справа от подписи; длинное или с пояснением — под ней. */
const INLINE_MAX = 16;

function textRow(label: string, value: string, note?: string): SummaryRow {
  return { kind: "text", label, value, ...(note ? { note } : {}), stacked: value.length > INLINE_MAX || Boolean(note) };
}

function measurementRow(view: PublicExecutorView): SummaryRow {
  const label = t.rows.measurement;
  const m = t.measurement;
  if (view.measurementTerms === "FREE") return textRow(label, m.FREE);
  if (view.measurementTerms === "INCLUDED") return textRow(label, m.INCLUDED);
  const fee = view.measurementFee;
  if (fee !== null && fee > 0) return { kind: "fee", label, feeTiyn: toTiyn(fee), value: m.feeSuffix, note: m.feeNote, stacked: true };
  return textRow(label, m.feeUnknown, m.feeNote);
}

function summaryRows(view: PublicExecutorView): SummaryRow[] {
  const rows: SummaryRow[] = [
    { kind: "rating", label: t.rows.rating, value: view.reviewsCount > 0 ? view.ratingAvg : null, count: view.reviewsCount },
    textRow(t.rows.deals, t.deals(view.completedDeals)),
    textRow(t.rows.years, view.yearsExperience > 0 ? t.years(view.yearsExperience) : t.yearsUnknown),
  ];
  if (view.specializations.length > 0) {
    rows.push(textRow(t.rows.specializations, view.specializations.map((s) => s.name).join(", ")));
  }
  rows.push(measurementRow(view));
  if (view.address.trim()) rows.push(textRow(t.rows.address, view.address.trim()));
  return rows;
}

/**
 * Чистая view-модель профиля мастера: из ответа `getPublicExecutorPage` — сводка, «О мастере», работы, отзывы,
 * пояснение и действие. Без ввода-вывода. Берёт ровно то, что отдал модуль (`toPublicView`, `maskContacts`,
 * `maskIdentity` уже применены): телефона, Instagram, наименования в режиме HIDDEN и ИИН/БИН здесь нет и взять неоткуда.
 */
export function executorView(page: PublicExecutorPage): ExecutorViewModel {
  const { view } = page;
  const latest = page.portfolio[0];
  return {
    title: view.label,
    backHref: to("/catalog"),
    rows: summaryRows(view),
    about: page.about
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    works: page.portfolio.map((card) => ({ ...workCardView(card), href: requestHref(card.id) })),
    reviews: page.reviews.map((r) => ({ id: r.id, ratingLabel: t.reviewRating(r.rating), date: dateFormat.format(r.createdAt), text: r.text.trim() })),
    explain: view.nameShown ? t.explain.shown : t.explain.hidden,
    action: latest ? { href: requestHref(latest.id), label: t.action } : null,
  };
}
