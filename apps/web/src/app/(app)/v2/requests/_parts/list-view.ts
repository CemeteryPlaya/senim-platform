import type { RequestStatus } from "@/generated/prisma/enums";
import { groupOf, REQUEST_GROUP, REQUEST_GROUPS, type RequestGroup } from "@/features/requests/labels";
import { formatShortDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { ChipItem, StatusTone } from "@/kit";
import { WIZARD_SCREENS } from "@/modules/requests/client";
import { to } from "../../../_shell/paths";
import { requestState, type RequestOfferInput } from "../../_parts/request-state";
import { wizardHref } from "../new/steps";

// Вид «Моих заявок» (чистая функция, без React и базы): разделы-чипы, строки заявок, какое пустое состояние показать.

const t = ru.app.requests.list;

/** Строка «Моих заявок» в том объёме, что нужен виду (подмножество `listMyRequests`). */
export type MyRequestRow = {
  id: string;
  title: string;
  status: RequestStatus;
  mode: "TENDER" | "DIRECT";
  wizardStep: number;
  createdAt: Date;
  publishedAt: Date | null;
  /** Обложка — первое фото помещения (модуль); нет — `null`. */
  cover?: { src: string } | null;
};

export type RequestCard = {
  id: string;
  href: string;
  title: string;
  /** Состояние полностью (`requestState().text`). */
  status: string;
  tone: StatusTone;
  /** Плашка в строке — коротко («Выберите мастера»), пояснение к ней — `note` («3 предложения»). */
  chip: string;
  note: string | null;
  meta: string;
  /** Адрес миниатюры 56 px; `null` — фото нет. */
  cover: string | null;
};

export type RequestListView = {
  group: RequestGroup | "all";
  /** Чипы разделов; пустой список — чипов нет. */
  chips: ChipItem[];
  cards: RequestCard[];
  /** `none` — заявок нет совсем (обучающий экран), `filter` — пуст выбранный раздел, `null` — есть что показать. */
  empty: "none" | "filter" | null;
};

/** Адрес раздела: «Все» — без параметра. */
const groupHref = (group: RequestGroup | "all") => (group === "all" ? to("/requests") : `${to("/requests")}?${new URLSearchParams({ status: group })}`);

/**
 * Черновик ведёт в мастер на свой шаг (resumeIndex модуля), отправленная — на карточку заявки. Статус и тон — общая
 * `requestState` (те же слова, что на главной и в карточке); в строке — короткая плашка и число предложений рядом с ней.
 */
function cardOf(r: MyRequestRow, offers: readonly RequestOfferInput[], now: Date): RequestCard {
  const draft = r.status === "DRAFT";
  // Дата — короткая («21 окт», год — только если не текущий): строка списка, а не документ.
  const meta = draft
    ? t.draftProgress(Math.min(r.wizardStep, WIZARD_SCREENS.length), WIZARD_SCREENS.length)
    : [r.mode === "DIRECT" ? t.direct : null, t.sentOn(formatShortDate(r.publishedAt ?? r.createdAt, now))].filter(Boolean).join(" · ");
  const state = requestState({ status: r.status, offers });
  return {
    id: r.id,
    href: draft ? wizardHref({ draft: r.id }) : to(`/requests/${encodeURIComponent(r.id)}`),
    // У черновика без выбранного типа названия ещё нет.
    title: draft && r.title === ru.requests.untitled ? t.draftTitle : r.title,
    status: state.text,
    tone: state.tone,
    chip: state.chip,
    note: state.note,
    meta,
    cover: r.cover?.src ?? null,
  };
}

/**
 * Разделы — группы статусов из `src/features/requests` (черновики, ищем мастера, мастер выбран, со сделкой, отменённые) и
 * «Все»; пустые разделы не показываются (выбранный остаётся, даже если опустел). Раздел из адреса (`?status=`) разбирает
 * `groupOf`: неизвестное значение — «Все». `offers` — предложения заявок (`myOfferStates`) по заявке; нет записи — нет
 * предложений.
 */
export function requestListView(
  list: readonly MyRequestRow[],
  status: string | undefined,
  offers: ReadonlyMap<string, readonly RequestOfferInput[]> = new Map(),
  now: Date = new Date(),
): RequestListView {
  const group = groupOf(status);
  if (list.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const count = (g: RequestGroup) => list.filter((r) => REQUEST_GROUP[r.status] === g).length;
  const chips: ChipItem[] = [
    { href: groupHref("all"), label: t.chip(t.all, list.length), active: group === "all" },
    ...REQUEST_GROUPS.filter((g) => count(g) > 0 || g === group).map((g) => ({ href: groupHref(g), label: t.chip(t.groups[g], count(g)), active: g === group })),
  ];
  const shown = group === "all" ? list : list.filter((r) => REQUEST_GROUP[r.status] === group);
  return { group, chips, cards: shown.map((r) => cardOf(r, offers.get(r.id) ?? [], now)), empty: shown.length === 0 ? "filter" : null };
}
