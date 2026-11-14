import "server-only";
import type { DealStatus, OfferStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { loadOwnRequest, requireClient } from "./access";
import { pathOf, TZ_PATH } from "./flows";

/**
 * Действующие цены и состояние предложений своих заявок глазами покупателя — лёгкое чтение рядом с `listOffers` (те же
 * права: только свои заявки, отозванные отклики не отдаются). Нужно экранам, которые показывают заявку одним состоянием
 * (главная, «Мои заявки», карточка заявки): сколько предложений действует, какая у каждого цена сейчас, есть ли сделка.
 *
 * - `live` — торг по предложению идёт (отклик отправлен, заявка открыта, путь ТЗ) — то же правило, что у `getNegotiation`;
 * - `priceTiyn` — цена, которую покупатель видит сейчас: у предложения со сделкой — цена сделки (`Deal.priceTiyn`,
 *   принятая цена торга); иначе — последняя названная мастером цена торга (не отозванная); раундов нет — цена отклика;
 * - `deal` — сделка по предложению: её статус (для «Завершена» у заявки) или `null`.
 *
 * Ничего не пишет. Чужая заявка — NOT_FOUND (как `listOffers`); без `requestId` — все свои заявки.
 */

export type OfferPriceState = {
  offerId: string;
  requestId: string;
  status: OfferStatus;
  live: boolean;
  priceTiyn: bigint;
  deal: { status: DealStatus } | null;
};

export async function myOfferStates(user: CurrentUser, input: { requestId?: string } = {}): Promise<OfferPriceState[]> {
  requireClient(user);
  if (input.requestId) await loadOwnRequest(db, user, input.requestId);
  const offers = await db.offer.findMany({
    where: { status: { not: "WITHDRAWN" }, request: { clientId: user.id }, ...(input.requestId ? { requestId: input.requestId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      requestId: true,
      status: true,
      priceTiyn: true,
      request: { select: { status: true, preContractFlow: true } },
      deal: { select: { status: true, priceTiyn: true } },
      proposals: {
        where: { party: "EXECUTOR", status: { not: "WITHDRAWN" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { amountTiyn: true },
      },
    },
  });
  return offers.map((o) => ({
    offerId: o.id,
    requestId: o.requestId,
    status: o.status,
    live: o.status === "SENT" && o.request.status === "OPEN" && pathOf(o.request) === TZ_PATH,
    priceTiyn: o.deal?.priceTiyn ?? o.proposals[0]?.amountTiyn ?? o.priceTiyn,
    deal: o.deal && { status: o.deal.status },
  }));
}
