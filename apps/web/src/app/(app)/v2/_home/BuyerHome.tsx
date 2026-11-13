import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { getDealView, listDeals } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { listMyRequests } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { isEnabled } from "@/platform/features";
import { logger } from "@/platform/logger";
import { BuyerHomeView } from "./BuyerHomeView";
import { buyerHome, firstName, type HomeDealInput, type HomeRequestInput } from "./buyer-home";

/** Сколько сделок читаем целиком ради «что дальше»: идущие, а при включённых отзывах — ещё недавно завершённые. */
const NEXT_LOOKUP = 5;

/**
 * Главная покупателя. Данные читает здесь (страница не знает про модули), показ — в `BuyerHomeView`. «Что дальше» у
 * сделки — из `getDealView` (одно правило с экраном сделки); сбой чтения одной сделки не роняет главную: она
 * показывается без подсказки «что дальше».
 */
export async function BuyerHome({ user, device }: { user: CurrentUser; device: Device }) {
  const [requests, allDeals] = await Promise.all([listMyRequests(user), listDeals(user)]);
  const mine = allDeals.filter((d) => d.myRole === "CLIENT");
  const reviews = isEnabled("reviews");
  // Сначала идущие, затем (при включённых отзывах) завершённые: ждать отзыва может и завершённая сделка.
  const running = mine.filter((d) => ACTIVE_DEAL.has(d.status));
  const finished = reviews ? mine.filter((d) => d.status === "SPLIT_PAYOUT") : [];
  const lookup = new Set([...running, ...finished].slice(0, NEXT_LOOKUP).map((d) => d.id));
  const nexts = new Map(
    await Promise.all(
      [...lookup].map(async (id) => {
        try {
          return [id, (await getDealView(user, id)).next] as const;
        } catch (error) {
          logger.warn("home deal next failed", { dealId: id, error });
          return [id, null] as const;
        }
      }),
    ),
  );
  const deals: HomeDealInput[] = mine.map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    hasOpenDispute: d.hasOpenDispute,
    paid: d.money.kind !== "awaiting",
    next: nexts.get(d.id) ?? null,
  }));
  const inputs: HomeRequestInput[] = requests.map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status, offersCount: r.offersCount }));
  const view = buyerHome({ deals, requests: inputs });
  const shown = view.deal ? (mine.find((d) => d.id === view.deal?.id) ?? null) : null;
  return <BuyerHomeView view={view} name={firstName(user.fullName)} deal={shown} device={device} />;
}
