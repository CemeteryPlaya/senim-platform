import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { inWorkCount, isFreshIncoming } from "@/features/executor-requests/incoming";
import { ru } from "@/i18n/ru";
import { getExecutorFinance, listDeals, monthOf, nextStepsOf, type NextStep } from "@/modules/deal-core";
import { getOwnKyc, getOwnPayout, type CurrentUser } from "@/modules/identity";
import { getNegotiation, listIncomingRequests, listMyOffers } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { logger } from "@/platform/logger";
import type { MasterStatus } from "../../_shell/auth";
import { consentMissingOf } from "../_parts/pay-waits";
import { readForMaster } from "../executor/_parts/approved";
import { MasterGate } from "../executor/_parts/MasterGate";
import { firstName } from "./buyer-home";
import { MasterHomeView, type MasterHomeData } from "./MasterHomeView";
import { masterHome, shownDeals, SHOWN_REQUESTS, type MasterCounterInput, type MasterDocsInput, type MasterHomeInput } from "./master-home";

/** Сколько отправленных предложений проверяем на встречную цену покупателя (свежие первыми): чтение — по одному на каждое. */
const COUNTER_CHECKED = 8;

/** Встречные цены покупателя по моим отправленным предложениям: торг идёт, открытое предложение — покупателя. */
async function countersOf(user: CurrentUser): Promise<MasterCounterInput[]> {
  const offers = (await listMyOffers(user)).filter((o) => o.status === "SENT").slice(0, COUNTER_CHECKED);
  const states = await Promise.all(
    offers.map((o) =>
      getNegotiation(user, { offerId: o.id }).catch((error: unknown) => {
        // Сбой чтения торга не роняет главную: предложение просто не попадёт в «Сейчас».
        logger.warn("home negotiation failed", { offerId: o.id, error });
        return null;
      }),
    ),
  );
  return offers.flatMap((o, index) => {
    const open = states[index]?.open;
    return open && open.party === "CLIENT" ? [{ requestId: o.requestId, requestTitle: ru.requests.requestTitle(o.number, o.title), amountTiyn: open.amountTiyn }] : [];
  });
}

/** Проверка документов и счёт для выплат; сбой чтения — «неизвестно» (`null`), главная остаётся. */
async function docsOf(user: CurrentUser): Promise<MasterDocsInput | null> {
  try {
    const [kyc, payout] = await Promise.all([getOwnKyc(user), getOwnPayout(user)]);
    return { kyc: kyc.state, payoutSet: payout.last4 !== null };
  } catch (error) {
    logger.warn("home documents failed", { error });
    return null;
  }
}

/**
 * Главная одобренного мастера. Данные читает здесь (страница не знает про модули), показ — в `MasterHomeView`. «Что дальше»
 * по сделкам — из лёгкого `nextStepsOf` (то же правило, что на экране сделки); документы и счёт читаются, только когда нет
 * более срочного (они идут через identity). Нет одобрения — экран статуса.
 */
export async function MasterHome({ user, status, device }: { user: CurrentUser; status: MasterStatus; device: Device }) {
  const read = await readForMaster(status, async () => {
    const [incoming, allDeals, finance, counters] = await Promise.all([listIncomingRequests(user), listDeals(user), getExecutorFinance(user), countersOf(user)]);
    return { incoming, allDeals, finance, counters };
  });
  const name = firstName(user.fullName);
  if ("gate" in read) return <MasterGate status={read.gate} title={ru.app.masterRequests.home.title(name)} device={device} />;

  const { incoming, allDeals, finance, counters } = read.data;
  const mine = allDeals.filter((d) => d.myRole === "EXECUTOR");
  const running = mine.filter((d) => ACTIVE_DEAL.has(d.status));
  const nexts = await nextStepsOf(
    user,
    running.map((d) => d.id),
  ).catch((error: unknown) => {
    // Сбой чтения не роняет главную: сделка покажется без подсказки «что дальше».
    logger.warn("home next steps failed", { error });
    return new Map<string, NextStep>();
  });
  const missing = await consentMissingOf(user, nexts);
  const fresh = incoming.filter(isFreshIncoming);
  const input: MasterHomeInput = {
    deals: mine.map((d) => ({ id: d.id, title: d.title, status: d.status, hasOpenDispute: d.hasOpenDispute, next: nexts.get(d.id) ?? null, consentMissing: missing.has(d.id) })),
    counters,
    freshCount: fresh.length,
    docs: null,
  };
  let view = masterHome(input);
  // Документы и счёт — только когда ничего срочнее нет.
  if (view.now.kind === "in-work" || view.now.kind === "empty") view = masterHome({ ...input, docs: await docsOf(user) });

  const { shown, more } = shownDeals(running, view.now.deal?.id ?? null);
  const month = monthOf(new Date());
  const data: MasterHomeData = {
    view,
    deals: shown.map((d) => ({ item: d, next: nexts.get(d.id) ?? null, consentMissing: missing.has(d.id) })),
    moreDeals: more,
    fresh: fresh.slice(0, SHOWN_REQUESTS),
    stats: { fresh: fresh.length, inWork: inWorkCount(mine), earnedTiyn: finance.months.find((m) => m.month === month)?.receivedTiyn ?? 0n },
  };
  return <MasterHomeView data={data} name={name} device={device} />;
}
