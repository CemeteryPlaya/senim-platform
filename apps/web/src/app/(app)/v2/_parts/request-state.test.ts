import { describe, expect, it } from "vitest";
import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { offersByRequest, requestState, type RequestOfferInput } from "./request-state";

const s = ru.app.requests.state;
const live: RequestOfferInput = { live: true, deal: null };
const closed: RequestOfferInput = { live: false, deal: null };
const withDeal = (status: DealStatus): RequestOfferInput => ({ live: false, deal: { status } });

describe("requestState: одна заявка — одно состояние на главной, в «Моих заявках» и в карточке", () => {
  it.each<[string, RequestStatus, RequestOfferInput[], string, string, string, number]>([
    ["черновик", "DRAFT", [], "draft", s.draft, "neutral", 0],
    ["открыта, предложений нет", "OPEN", [], "waiting", s.waiting, "neutral", 0],
    ["открыта, одно действующее", "OPEN", [live], "choose", "1 предложение — выберите мастера", "warn", 1],
    ["открыта, два действующих и отклонённое — считаются только действующие", "OPEN", [live, live, closed], "choose", "2 предложения — выберите мастера", "warn", 2],
    ["открыта, пять действующих", "OPEN", [live, live, live, live, live], "choose", "5 предложений — выберите мастера", "warn", 5],
    ["открыта, предложения есть, но торг по ним закрыт — ждём", "OPEN", [closed, closed], "waiting", s.waiting, "neutral", 0],
    ["ждёт замера площадки", "PLATFORM_MEASURING", [], "site-measuring", s.siteMeasuring, "neutral", 0],
    ["мастер выбран (сценарий до договора)", "OFFER_CHOSEN", [closed], "chosen", s.chosen, "neutral", 0],
    ["идёт замер (сценарий до договора)", "MEASURING", [closed], "measuring", s.measuring, "neutral", 0],
    ["оферта не подписана — идёт сделка", "CONTRACTING", [withDeal("CREATED"), closed], "deal", s.deal, "neutral", 0],
    ["оферта заключена, сделка идёт", "CLOSED", [withDeal("IN_PROGRESS")], "deal", s.deal, "neutral", 0],
    ["выплата идёт — ещё «Идёт сделка»", "CLOSED", [withDeal("ACCEPTED")], "deal", s.deal, "neutral", 0],
    ["сделка завершена", "CLOSED", [withDeal("SPLIT_PAYOUT"), closed], "done", s.done, "accent", 0],
    ["отменена", "CANCELLED", [closed], "cancelled", s.cancelled, "neutral", 0],
    ["отменена вместе со сделкой", "CANCELLED", [withDeal("REFUNDED")], "cancelled", s.cancelled, "neutral", 0],
  ])("%s", (_name, status, offers, kind, text, tone, n) => {
    expect(requestState({ status, offers })).toMatchObject({ kind, text, tone, liveOffers: n });
  });

  it("плашка в строке списка — коротко: «Выберите мастера», число предложений — строкой рядом; остальные — тот же текст", () => {
    expect(requestState({ status: "OPEN", offers: [live, live, live] })).toMatchObject({ chip: s.chooseShort, note: "3 предложения" });
    expect(requestState({ status: "OPEN", offers: [] })).toMatchObject({ chip: s.waiting, note: null });
    expect(requestState({ status: "CLOSED", offers: [withDeal("IN_PROGRESS")] })).toMatchObject({ chip: s.deal, note: null });
  });

  it("один текст — один тон; ни «договора», ни «отклика»", () => {
    const tones = new Map<string, string>();
    const statuses: RequestStatus[] = ["DRAFT", "OPEN", "PLATFORM_MEASURING", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"];
    const sets: RequestOfferInput[][] = [[], [live], [live, live], [closed], [withDeal("PAID_HOLD")], [withDeal("SPLIT_PAYOUT")]];
    for (const status of statuses) {
      for (const offers of sets) {
        const st = requestState({ status, offers });
        expect(st.text).not.toMatch(/договор|отклик/i);
        expect(tones.get(st.text) ?? st.tone).toBe(st.tone);
        tones.set(st.text, st.tone);
      }
    }
  });

  it("offersByRequest раскладывает предложения по заявкам", () => {
    const map = offersByRequest([
      { requestId: "a", live: true },
      { requestId: "b", live: false },
      { requestId: "a", live: false },
    ]);
    expect(map.get("a")?.map((o) => o.live)).toEqual([true, false]);
    expect(map.get("b")).toHaveLength(1);
    expect(map.get("c")).toBeUndefined();
  });
});
