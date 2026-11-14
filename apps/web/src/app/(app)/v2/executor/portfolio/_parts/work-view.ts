import { ru } from "@/i18n/ru";
import type { OwnPortfolioItem } from "@/modules/companies";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { cardsMedia, toTiyn } from "../../../_parts/work-card";
import { to } from "../../../../_shell/paths";

// Портфолио мастера: чистая сборка того, что показывают экраны (список, форма). Деньги — цена «от» в тиынах из целых
// тенге модуля (`toTiyn`); ничего не считается.

const t = ru.app.masterPortfolio;

/** Корень статических иллюстраций сида: это не фото мастера (тот же приём, что у каталога). */
const SEED_ILLUSTRATIONS = "/demo/";

export type WorkRow = {
  id: string;
  href: string;
  title: string;
  /** «Опубликована» / «Скрыта» — в `StatusChip`. */
  status: string;
  /** Вторая строка: «Тип · стиль · фото: N». */
  details: string;
  published: boolean;
  priceFrom?: bigint;
  photo?: { src: string; alt: string };
};

export type WorkListView = { rows: WorkRow[]; media: "none" | "slot"; countText: string };

export const workHref = (id: string): string => to(`/executor/portfolio/${id}`);

export function workRow(item: OwnPortfolioItem): WorkRow {
  const cover = item.photos.find((p) => p.src !== null && !p.src.startsWith(SEED_ILLUSTRATIONS));
  return {
    id: item.id,
    href: workHref(item.id),
    title: item.title,
    status: item.published ? t.list.published : t.list.hidden,
    details: [item.furnitureType.name, item.style.name, t.list.photos(item.photos.length)].join(" · "),
    published: item.published,
    // Ноль — «цена не указана», а не «бесплатно».
    ...(item.priceFrom !== null && item.priceFrom > 0 ? { priceFrom: toTiyn(item.priceFrom) } : {}),
    ...(cover?.src ? { photo: { src: cover.src, alt: cover.alt } } : {}),
  };
}

export function workListView(items: readonly OwnPortfolioItem[]): WorkListView {
  const rows = items.map(workRow);
  return { rows, media: cardsMedia(rows), countText: t.list.count(rows.length) };
}

/** Значения формы: все поля — строки (число — как его вводят). */
export type WorkValues = {
  furnitureTypeId: string;
  style: StyleKey | "";
  title: string;
  description: string;
  place: string;
  price: string;
  published: boolean;
};

export const EMPTY_VALUES: WorkValues = { furnitureTypeId: "", style: "", title: "", description: "", place: "", price: "", published: true };

export function initialValues(item: OwnPortfolioItem): WorkValues {
  return {
    furnitureTypeId: item.furnitureType.id,
    style: item.style.key in STYLES ? (item.style.key as StyleKey) : "",
    title: item.title,
    description: item.description,
    place: item.place,
    price: item.priceFrom === null ? "" : String(item.priceFrom),
    published: item.published,
  };
}

/** Варианты стиля для выбора карточками: название и подсказка из справочника мебели. */
export const STYLE_OPTIONS: readonly { value: StyleKey; label: string; description: string }[] = (Object.entries(STYLES) as [StyleKey, (typeof STYLES)[StyleKey]][]).map(
  ([value, s]) => ({ value, label: s.name, description: s.hint }),
);

/** Число из поля ввода: пробелы-разделители (в том числе неразрывные) допустимы, пустое поле — null. */
export function toPrice(raw: string): number | null {
  const clean = raw.replace(/\s/g, "");
  return clean === "" ? null : Number(clean);
}
