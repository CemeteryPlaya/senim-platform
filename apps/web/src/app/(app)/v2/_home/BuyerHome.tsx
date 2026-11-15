import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { listDeals, nextStepsOf, type DealListItem, type NextStep } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { listMyRequests, myOfferStates } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { isEnabled } from "@/platform/features";
import { logger } from "@/platform/logger";
import { dealCover, type DealCover } from "../_parts/deal-cover";
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
  const cover = shown ? await dealCover(user, shown) : null;
  const inWork = shown && !cover ? await inWorkWithCover(user, mine, shown.id) : null;
  return <BuyerHomeView view={view} name={firstName(user.fullName)} deal={shown} cover={cover} inWork={inWork} device={device} />;
}

/** Статусы «в работе»: мастер делает мебель или сдал её — у такой сделки бывают отчёты с фото. */
const IN_WORK = new Set<DealListItem["status"]>(["IN_PROGRESS", "READY"]);

/** Сколько сделок «в работе» читать в поисках обложки: чтение сделки не бесплатное, главной хватит первых. */
const IN_WORK_READS = 2;

/**
 * Вторая карточка-герой (разбор 3.1, «главная покупателя»): у текущей сделки фото нет — первая из других сделок «в работе»,
 * у которой есть фото отчёта. Обложку читает тот же `dealCover` (только статусы с отчётами, сбой — без обложки).
 */
async function inWorkWithCover(user: CurrentUser, deals: DealListItem[], shownId: string): Promise<{ deal: DealListItem; cover: DealCover } | null> {
  const candidates = deals.filter((d) => d.id !== shownId && IN_WORK.has(d.status) && !d.hasOpenDispute).slice(0, IN_WORK_READS);
  const covers = await Promise.all(candidates.map((d) => dealCover(user, d)));
  const index = covers.findIndex((c) => c !== null);
  const found = index >= 0 ? covers[index] : null;
  return found ? { deal: candidates[index]!, cover: found } : null;
}
