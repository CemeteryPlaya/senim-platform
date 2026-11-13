import type { RequestStatus } from "@/generated/prisma/enums";
import { groupOf, REQUEST_GROUP, REQUEST_GROUPS, type RequestGroup } from "@/features/requests/labels";
import { formatDate } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { ChipItem, StatusTone } from "@/kit";
import { WIZARD_SCREENS } from "@/modules/requests/client";
import { to } from "../../../_shell/paths";
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
  offersCount: number;
};

export type RequestCard = { id: string; href: string; title: string; status: string; tone: StatusTone; meta: string };

export type RequestListView = {
  group: RequestGroup | "all";
  /** Чипы разделов; пустой список — чипов нет. */
  chips: ChipItem[];
  cards: RequestCard[];
  /** `none` — заявок нет совсем (обучающий экран), `filter` — пуст выбранный раздел, `null` — есть что показать. */
  empty: "none" | "filter" | null;
};

/** Тон статуса: идёт нормально — accent, нужно действие (договор) — warn, черновик и завершённые — нейтральные. */
export const STATUS_TONE: Record<RequestStatus, StatusTone> = {
  DRAFT: "neutral",
  PLATFORM_MEASURING: "accent",
  OPEN: "accent",
  OFFER_CHOSEN: "accent",
  MEASURING: "accent",
  CONTRACTING: "warn",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

/** Адрес раздела: «Все» — без параметра. */
const groupHref = (group: RequestGroup | "all") => (group === "all" ? to("/requests") : `${to("/requests")}?${new URLSearchParams({ status: group })}`);

/** Черновик ведёт в мастер на свой шаг (resumeIndex модуля), отправленная — на карточку заявки. */
function cardOf(r: MyRequestRow): RequestCard {
  const draft = r.status === "DRAFT";
  const meta = draft
    ? t.draftProgress(Math.min(r.wizardStep, WIZARD_SCREENS.length), WIZARD_SCREENS.length)
    : [t.offers(r.offersCount), r.mode === "DIRECT" ? t.direct : null, t.sentOn(formatDate(r.publishedAt ?? r.createdAt))].filter(Boolean).join(" · ");
  return {
    id: r.id,
    href: draft ? wizardHref({ draft: r.id }) : to(`/requests/${encodeURIComponent(r.id)}`),
    // У черновика без выбранного типа названия ещё нет.
    title: draft && r.title === ru.requests.untitled ? t.draftTitle : r.title,
    status: t.status[r.status],
    tone: STATUS_TONE[r.status],
    meta,
  };
}

/**
 * Разделы — группы статусов из `src/features/requests` (черновики, ждут предложений, мастер выбран, договор, отменённые) и
 * «Все»; пустые разделы не показываются (выбранный остаётся, даже если опустел). Раздел из адреса (`?status=`) разбирает
 * `groupOf`: неизвестное значение — «Все».
 */
export function requestListView(list: readonly MyRequestRow[], status: string | undefined): RequestListView {
  const group = groupOf(status);
  if (list.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const count = (g: RequestGroup) => list.filter((r) => REQUEST_GROUP[r.status] === g).length;
  const chips: ChipItem[] = [
    { href: groupHref("all"), label: t.chip(t.all, list.length), active: group === "all" },
    ...REQUEST_GROUPS.filter((g) => count(g) > 0 || g === group).map((g) => ({ href: groupHref(g), label: t.chip(t.groups[g], count(g)), active: g === group })),
  ];
  const shown = group === "all" ? list : list.filter((r) => REQUEST_GROUP[r.status] === group);
  return { group, chips, cards: shown.map(cardOf), empty: shown.length === 0 ? "filter" : null };
}
