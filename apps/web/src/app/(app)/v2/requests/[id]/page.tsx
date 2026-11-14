import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { getClientRequest, getDraft, listOffers, myOfferStates, REQUEST_TRANSITIONS } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { pageHref, requireBuyer } from "../../../_shell/auth";
import { requestState } from "../../_parts/request-state";
import { detailRows, draftHref, nowView, offersView, parseSort, photoView, sentNotice, type OfferInput } from "./_parts/card-view";
import { RequestCardView, type CardView } from "./_parts/RequestCardView";

export const metadata: Metadata = { title: ru.app.requestCard.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/** Чужая и несуществующая заявка — NOT_FOUND модуля — это 404; прочие ошибки идут дальше. */
async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** Отмена разрешена, когда её разрешает таблица переходов заявки для заказчика. */
const cancellable = (status: RequestStatus): boolean =>
  REQUEST_TRANSITIONS.some((rule) => rule.action === "cancel" && rule.who.includes("CLIENT") && (rule.from as readonly RequestStatus[]).includes(status));

/**
 * Карточка заявки покупателя: что сейчас, предложения мастеров (сортировка в адресе `?sort=`), что в заявке, отмена в меню.
 * Мастер — «Исполнитель №N», как отдаёт модуль. Выбрать мастера можно на экране предложения (торг и «Принять цену»);
 * здесь — переход к нему. Черновик ведёт в мастер заявки.
 */
export default async function RequestCardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireBuyer(pageHref(`/requests/${encodeURIComponent(id)}`, sp));
  const request = await orNotFound(getClientRequest(user, id));
  if (request.status === "DRAFT") redirect(draftHref(id));

  const sort = parseSort(one(sp.sort));
  // Фото помещения и мастер прямой заявки приходят от модуля вместе с «черновиком» (то же чтение своей заявки); действующие
  // цены и состояние предложений — лёгким чтением `myOfferStates` (цена торга или сделки, а не первая цена отклика).
  const [offers, own, states] = await Promise.all([
    orNotFound(listOffers(user, { requestId: id, sort })),
    orNotFound(getDraft(user, id)),
    orNotFound(myOfferStates(user, { requestId: id })),
  ]);
  const device = await getDevice();

  const stateOf = new Map(states.map((s) => [s.offerId, s]));
  const inputs: OfferInput[] = offers.map((o) => {
    const st = stateOf.get(o.id);
    return { ...o, live: st?.live ?? false, priceTiyn: st?.priceTiyn ?? o.priceTiyn, withDeal: (st?.deal ?? null) !== null };
  });
  // Одно состояние заявки на всех экранах: «Пришло N предложений» — только действующие (торг по ним идёт).
  const state = requestState({ status: request.status, offers: states });
  const notice = sentNotice(one(sp.sent) === "1", request.status, request.mode, state.liveOffers);
  const withoutSent = Object.fromEntries(Object.entries(sp).filter(([key]) => key !== "sent"));
  const now = nowView({
    id,
    mode: request.mode,
    state,
    dealId: request.deal?.id ?? null,
    chosenOfferId: request.chosen?.id ?? null,
  });
  const view: CardView = {
    id,
    title: request.title,
    number: request.number,
    sent: notice && { ...notice, href: pageHref(`/requests/${encodeURIComponent(id)}`, withoutSent) },
    chip: { text: state.text, tone: state.tone },
    now,
    offers: offersView({ id, status: request.status, mode: request.mode }, inputs, sort),
    details: detailRows({
      title: request.title,
      style: request.style,
      segment: request.segment,
      details: request.details,
      city: request.city,
      address: request.address,
      wishes: request.wishes,
      directLabel: request.mode === "DIRECT" ? own.targetLabel : null,
    }),
    photos: photoView(own.photos),
    cancel: cancellable(request.status) ? { offersCount: state.liveOffers, direct: request.mode === "DIRECT" } : null,
  };
  return <RequestCardView view={view} device={device} />;
}
