import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { listDeals, nextStepsOf, type NextStep } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { listMyRequests, myOfferStates } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { isEnabled } from "@/platform/features";
import { logger } from "@/platform/logger";
import { dealCover } from "../_parts/deal-cover";
import { payWaitingMaster } from "../_parts/pay-waits";
import { offersByRequest } from "../_parts/request-state";
import { BuyerHomeView } from "./BuyerHomeView";
import { buyerHome, firstName, type HomeDealInput, type HomeRequestInput } from "./buyer-home";

/**
 * Главная покупателя. Данные читает здесь (страница не знает про модули), показ — в `BuyerHomeView`. «Что дальше» —
 * из лёгкого `nextStepsOf` (то же правило, что на экране сделки), без ограничения числа сделок.
 */
export async function BuyerHome({ user, device }: { user: CurrentUser; device: Device }) {
  const [requests, allDeals, offerStates] = await Promise.all([listMyRequests(user), listDeals(user), myOfferStates(user)]);
  const mine = allDeals.filter((d) => d.myRole === "CLIENT");
  const reviews = isEnabled("reviews");
  // «Что дальше» нужно по идущим сделкам и (при включённых отзывах) по завершённым: отзыв ждёт и завершённая сделка.
  const wanted = mine.filter((d) => ACTIVE_DEAL.has(d.status) || (reviews && d.status === "SPLIT_PAYOUT")).map((d) => d.id);
  const nexts = await nextStepsOf(user, wanted).catch((error: unknown) => {
    // Сбой чтения не роняет главную: сделка покажется со ссылкой «Открыть сделку» вместо подсказки.
    logger.warn("home next steps failed", { error });
    return new Map<string, NextStep>();
  });
  const waiting = await payWaitingMaster(user, nexts);
  const deals: HomeDealInput[] = mine.map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    hasOpenDispute: d.hasOpenDispute,
    paid: d.money.kind !== "awaiting",
    next: nexts.get(d.id) ?? null,
    payWaitsMaster: waiting.has(d.id),
  }));
  const offers = offersByRequest(offerStates);
  const inputs: HomeRequestInput[] = requests.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    offers: offers.get(r.id) ?? [],
    cover: r.cover?.src ?? null,
  }));
  const view = buyerHome({ deals, requests: inputs });
  const shown = view.deal ? (mine.find((d) => d.id === view.deal?.id) ?? null) : null;
  // Обложка карточки-героя — последнее фото отчёта хода работ этой сделки (если есть).
  const cover = shown ? await dealCover(user, shown.id) : null;
  return <BuyerHomeView view={view} name={firstName(user.fullName)} deal={shown} cover={cover} device={device} />;
}
