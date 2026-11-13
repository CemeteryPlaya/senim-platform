import type { Page } from "@playwright/test";
import { Client } from "pg";
import { assertSafeDatabase } from "./safe-database";

/**
 * Предложения мастеров по заявкам засеянного покупателя — чтением из базы e2e (E2E_DATABASE_URL, только «senim_v2web_*»).
 * Нужны сценариям экрана предложения: id заявок и откликов сид раздаёт при каждом пересеве заново, а экран карточки
 * заявки (откуда на предложение ведут ссылки) делает другая задача. Только SELECT: данные базы не меняются.
 */

export type Round = { party: "CLIENT" | "EXECUTOR"; status: "PROPOSED" | "SUPERSEDED" | "WITHDRAWN" | "ACCEPTED"; amountTiyn: bigint };

export type BuyerOffer = {
  requestId: string;
  offerId: string;
  publicNumber: number;
  offerStatus: string;
  requestStatus: string;
  /** Заявка идёт сценарием до договора (флаг preContractFlows): торга нет. */
  preContract: boolean;
  rounds: Round[];
  dealId: string | null;
};

/** Состояние торга, как его видит экран (offer-view.ts, offerState). */
export type OfferKind = "masterPrice" | "masterCounter" | "waiting" | "deal" | "otherChosen";

export function kindOf(o: BuyerOffer): OfferKind | null {
  if (o.dealId) return "deal";
  const live = o.offerStatus === "SENT" && o.requestStatus === "OPEN" && !o.preContract;
  if (!live) return o.offerStatus === "DECLINED" && o.requestStatus !== "CANCELLED" && !o.preContract ? "otherChosen" : null;
  const open = o.rounds.find((r) => r.status === "PROPOSED");
  if (!open) return null;
  if (open.party === "CLIENT") return "waiting";
  return o.rounds.some((r) => r.party === "CLIENT") ? "masterCounter" : "masterPrice";
}

/** Предложения по заявкам покупателя с номером телефона `phone` (в виде «+7…»), по времени заявки и отклика. */
export async function buyerOffers(phone: string): Promise<BuyerOffer[]> {
  const url = process.env.E2E_DATABASE_URL ?? "";
  assertSafeDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{
      request_id: string;
      offer_id: string;
      public_number: number;
      offer_status: string;
      request_status: string;
      pre_contract: boolean;
      deal_id: string | null;
      rounds: { party: Round["party"]; status: Round["status"]; amount: string }[] | null;
    }>(
      `select r.id as request_id, o.id as offer_id, e."publicNumber" as public_number, o.status as offer_status,
              r.status as request_status, r."preContractFlow" is not null as pre_contract, d.id as deal_id,
              (select json_agg(json_build_object('party', p.party, 'status', p.status, 'amount', p."amountTiyn"::text)
                        order by p."createdAt", p.id)
                 from "PriceProposal" p where p."offerId" = o.id) as rounds
         from "Offer" o
         join "Request" r on r.id = o."requestId"
         join "User" u on u.id = r."clientId"
         join "ExecutorProfile" e on e.id = o."executorId"
         left join "Deal" d on d."offerId" = o.id
        where u.phone = $1
        order by r."createdAt", o."createdAt"`,
      [phone],
    );
    return rows.map((row) => ({
      requestId: row.request_id,
      offerId: row.offer_id,
      publicNumber: row.public_number,
      offerStatus: row.offer_status,
      requestStatus: row.request_status,
      preContract: row.pre_contract,
      dealId: row.deal_id,
      rounds: (row.rounds ?? []).map((p) => ({ party: p.party, status: p.status, amountTiyn: BigInt(p.amount) })),
    }));
  } finally {
    await client.end();
  }
}

/** Первое предложение в нужном состоянии или `null` (база уже изменена прогоном, меняющим данные). */
export async function findOffer(phone: string, kind: OfferKind): Promise<BuyerOffer | null> {
  return (await buyerOffers(phone)).find((o) => kindOf(o) === kind) ?? null;
}

export const offerPath = (o: Pick<BuyerOffer, "requestId" | "offerId">): string => `/v2/requests/${o.requestId}/offers/${o.offerId}`;

/** Засеянный покупатель тендера на кухню: телефон (для чтения базы) и имя демо-персоны (кнопка «Войти: …» на /demo). */
export const SEED_BUYER = { phone: "+77000000101", name: "Айгерим Сапарова" } as const;

/**
 * Вход засеянным покупателем одним нажатием на /demo (DEMO_MODE сервера e2e), как `loginAs` в e2e v1: SMS-вход того же
 * номера упирается в лимит кодов стенда (повтор раньше минуты, потолок в час) — номер сида делят все прогоны и снимки.
 * Сессия общая для v1 и v2.
 */
export async function signInSeedBuyer(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/demo");
  await page.getByRole("button", { name: `Войти: ${SEED_BUYER.name}` }).click();
  await page.waitForURL((u) => u.pathname !== "/demo");
}
