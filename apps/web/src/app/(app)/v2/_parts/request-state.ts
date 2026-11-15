import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { StatusTone } from "@/kit";

/**
 * Состояние заявки глазами покупателя — одно на главной, в «Моих заявках» и в карточке заявки (чистая функция без React
 * и базы). На вход — статус заявки и её предложения (`myOfferStates` модуля requests: идёт ли по предложению торг, есть ли
 * сделка и в каком она статусе); на выход — что сейчас (`kind`), текст и тон плашки, число действующих предложений.
 *
 * Действующее предложение — то, на которое покупатель может ответить сейчас: торг по нему идёт (`live`). Отклонённые,
 * выбранное, закрытые вместе с заявкой и отклики сценария до договора (торга нет) — не действуют и не считаются.
 *
 * | kind             | когда                                                | текст                              | тон       |
 * |------------------|------------------------------------------------------|------------------------------------|-----------|
 * | `draft`          | черновик                                             | «Черновик»                         | нейтральный |
 * | `waiting`        | открыта, действующих предложений нет                  | «Ждём предложений»                 | нейтральный |
 * | `choose`         | открыта, есть действующие предложения                 | «N предложений — выберите мастера» | внимание  |
 * | `site-measuring` | ждёт замера площадки                                 | «Ждём замера»                      | нейтральный |
 * | `chosen`         | мастер выбран (сценарий до договора)                 | «Мастер выбран»                    | нейтральный |
 * | `measuring`      | идёт замер (сценарий до договора)                    | «Идёт замер»                       | нейтральный |
 * | `deal`           | по заявке создана сделка, она не завершена            | «Идёт сделка»                      | нейтральный |
 * | `done`           | сделка по заявке завершена (выплата проведена)        | «Завершена»                        | зелёный (как у сделки) |
 * | `cancelled`      | заявка отменена (в том числе вместе со сделкой)       | «Отменена»                         | нейтральный |
 */

export type RequestStateKind = "draft" | "waiting" | "choose" | "site-measuring" | "chosen" | "measuring" | "deal" | "done" | "cancelled";

export type RequestOfferInput = { live: boolean; deal: { status: DealStatus } | null };

export type RequestStateInput = { status: RequestStatus; offers: readonly RequestOfferInput[] };

export type RequestState = {
  kind: RequestStateKind;
  text: string;
  tone: StatusTone;
  liveOffers: number;
  /**
   * Плашка в строке списка (главная, «Мои заявки»): коротко и без переноса. У `choose` — «Выберите мастера», а число
   * предложений — отдельной строкой рядом (`note`); у остальных — тот же `text`.
   */
  chip: string;
  /** Пояснение к короткой плашке строкой рядом («3 предложения»); `null` — плашка говорит всё сама. */
  note: string | null;
};

const t = ru.app.requests.state;

const state = (kind: RequestStateKind, text: string, tone: StatusTone, liveOffers: number): RequestState => ({ kind, text, tone, liveOffers, chip: text, note: null });

export function requestState({ status, offers }: RequestStateInput): RequestState {
  const live = offers.filter((o) => o.live).length;
  switch (status) {
    case "DRAFT":
      return state("draft", t.draft, "neutral", live);
    case "OPEN":
      return live > 0
        ? { ...state("choose", t.choose(live), "warn", live), chip: t.chooseShort, note: ru.app.requests.list.offers(live) }
        : state("waiting", t.waiting, "neutral", live);
    case "PLATFORM_MEASURING":
      return state("site-measuring", t.siteMeasuring, "neutral", live);
    case "OFFER_CHOSEN":
      return state("chosen", t.chosen, "neutral", live);
    case "MEASURING":
      return state("measuring", t.measuring, "neutral", live);
    case "CONTRACTING":
    case "CLOSED":
      return offers.some((o) => o.deal?.status === "SPLIT_PAYOUT") ? state("done", t.done, "accent", live) : state("deal", t.deal, "neutral", live);
    case "CANCELLED":
      return state("cancelled", t.cancelled, "neutral", live);
  }
}

/** Предложения заявки из `myOfferStates` (все свои заявки одним чтением) — по заявке. */
export function offersByRequest<T extends { requestId: string }>(states: readonly T[]): ReadonlyMap<string, T[]> {
  const map = new Map<string, T[]>();
  for (const s of states) map.set(s.requestId, [...(map.get(s.requestId) ?? []), s]);
  return map;
}
