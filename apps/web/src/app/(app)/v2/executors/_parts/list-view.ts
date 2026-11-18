import type { RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { EXECUTORS_PAGE_SIZE, type ExecutorListItem } from "@/modules/companies";
import { TZ_PATH, type RequestPath } from "@/modules/requests/client";
import { to } from "../../../_shell/paths";
import { cardsMedia, isUploadedSrc } from "../../_parts/work-card";

const t = ru.app.guest.executors;
const segments = ru.app.guest.executor.segments;

/** Параметры адреса списка: страница и заявка покупателя, для которой открыт список. */
export type ExecutorsSearch = { page: number; requestId: string | null };

/**
 * Заявка, для которой открыт список: своя у покупателя, открыта, на всех мастеров и путём ТЗ (страница проверила).
 * Ссылки списка несут её дальше, на страницу мастера.
 */
export type InviteContext = { requestId: string; number: number };

export type ExecutorCardView = {
  key: string;
  /** Профиль мастера v2. */
  href: string;
  /** Метка мастера, как отдал модуль (режим показа имени). */
  title: string;
  /** «Комфорт · 4,8 · 12 отзывов» или «Пока без отзывов». */
  meta: string;
  /** «Сделок: 15 · Успешных: 92%». */
  byline: string;
  /** Только загруженное фото; иллюстрация сида — заглушка. */
  photo?: { src: string; alt: string };
};

type EmptyView = { title: string; body: string; action: { href: string; label: string } };

export type ExecutorsListView = {
  state: "results" | "empty" | "beyond";
  lead: string;
  /** «Назад» к заявке, с которой пришли; без заявки — нет (список — экран верхнего уровня, как каталог). */
  back: { href: string; label: string } | null;
  cards: ExecutorCardView[];
  media: "none" | "slot";
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** Пустое состояние с единственным действием; при результатах — null. */
  empty: EmptyView | null;
  invite: InviteContext | null;
};

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
/** Идентификатор заявки в адресе: буквы, цифры, `_` и `-`, до 64 знаков; иное — как будто его нет. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseExecutorsSearch(params: Record<string, string | string[] | undefined>): ExecutorsSearch {
  const page = Number(first(params.page));
  const request = first(params.request);
  return { page: Number.isInteger(page) && page >= 1 ? page : 1, requestId: request && REQUEST_ID.test(request) ? request : null };
}

/** Приглашать мастеров можно в открытую заявку на всех мастеров, идущую путём ТЗ. */
export function invitable(r: { status: RequestStatus; mode: "TENDER" | "DIRECT"; path: RequestPath }): boolean {
  return r.status === "OPEN" && r.mode === "TENDER" && r.path === TZ_PATH;
}

function listHref(page: number, invite: InviteContext | null): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (invite) params.set("request", invite.requestId);
  const query = params.toString();
  return to(query ? `/executors?${query}` : "/executors");
}

function cardView(item: ExecutorListItem, invite: InviteContext | null): ExecutorCardView {
  const rating =
    item.reviewsCount > 0 ? t.rating(item.ratingAvg.toLocaleString("ru-RU", { maximumFractionDigits: 1 }), ru.app.guest.catalog.reviews(item.reviewsCount)) : t.noReviews;
  return {
    key: String(item.publicNumber),
    // С заявкой в адресе профиль тоже открыт для неё: оттуда мастера приглашают к этому заказу.
    href: to(`/executors/${item.publicNumber}${invite ? `?${new URLSearchParams({ request: invite.requestId })}` : ""}`),
    title: item.label,
    meta: [item.segment ? segments[item.segment] : null, rating].filter(Boolean).join(" · "),
    byline: t.statsLine(item.stats.deals, item.stats.successRate),
    ...(item.cover && isUploadedSrc(item.cover.src) ? { photo: item.cover } : {}),
  };
}

/**
 * Чистая view-модель общего списка мастеров: карточки, пагинация, пустые состояния и контекст заявки. Без ввода-вывода.
 * Мастер — ровно то, что отдал модуль (`listExecutors`: метка по ADR-006, без контактов и id).
 */
export function executorsListView(
  result: { items: ExecutorListItem[]; total: number },
  search: ExecutorsSearch,
  invite: InviteContext | null,
  perPage = EXECUTORS_PAGE_SIZE,
): ExecutorsListView {
  const pageCount = Math.max(1, Math.ceil(result.total / perPage));
  const state: ExecutorsListView["state"] = result.items.length > 0 ? "results" : result.total > 0 ? "beyond" : "empty";
  const hrefFor = (page: number) => listHref(page, invite);
  const empty: EmptyView | null = {
    results: null,
    empty: { title: t.empty.title, body: t.empty.body, action: { href: to("/"), label: t.empty.action } },
    beyond: { title: t.beyond.title, body: t.beyond.body(pageCount), action: { href: hrefFor(1), label: t.beyond.action } },
  }[state];
  const cards = result.items.map((item) => cardView(item, invite));
  return {
    state,
    lead: invite ? t.forRequest(invite.number) : t.lead,
    back: invite ? { href: to(`/requests/${encodeURIComponent(invite.requestId)}`), label: t.backToRequest } : null,
    cards,
    media: cardsMedia(cards),
    page: search.page,
    pageCount,
    hrefFor,
    empty,
    invite,
  };
}
