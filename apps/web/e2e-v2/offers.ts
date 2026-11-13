import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContextOptions } from "@playwright/test";
import { Client } from "pg";
import { offerState } from "../src/app/(app)/v2/requests/[id]/offers/[offerId]/_parts/offer-view";
import { assertSafeDatabase } from "./safe-database";
import { loginV2, passOnboarding } from "./support";

/**
 * Предложения мастеров по заявкам засеянного покупателя — чтением из базы e2e (E2E_DATABASE_URL, только «senim_v2web_*»)
 * и вход им для сценариев экрана предложения. id заявок и откликов сид раздаёт при каждом пересеве заново, а экран
 * карточки заявки (откуда на предложение ведут ссылки) делает другая задача. Только SELECT: данные базы не меняются.
 */

/** Засеянный покупатель тендера на кухню (src/demo/data.ts, «aigerim»). */
export const SEED_BUYER = { phone: "+77000000101" } as const;

export type Round = { id: string; party: "CLIENT" | "EXECUTOR"; status: "PROPOSED" | "SUPERSEDED" | "WITHDRAWN" | "ACCEPTED"; amountTiyn: bigint };

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

/** Состояние экрана: `kind` из offerState, у закрытого торга — его причина. */
export type OfferKind = "masterPrice" | "masterCounter" | "waiting" | "noPrice" | "deal" | "requestCancelled" | "otherChosen" | "closed";

/** Та же функция, что на экране (offerState); «торг идёт» — как `isLive` модуля requests. */
export function kindOf(o: BuyerOffer): OfferKind {
  const open = o.rounds.find((r) => r.status === "PROPOSED") ?? null;
  const state = offerState({
    live: o.offerStatus === "SENT" && o.requestStatus === "OPEN" && !o.preContract,
    open: open && { id: open.id, party: open.party, mine: open.party === "CLIENT", amountTiyn: open.amountTiyn },
    dealId: o.dealId,
    rounds: o.rounds.map((r) => ({ party: r.party, mine: r.party === "CLIENT" })),
    offerStatus: o.offerStatus as Parameters<typeof offerState>[0]["offerStatus"],
    requestStatus: o.requestStatus as Parameters<typeof offerState>[0]["requestStatus"],
  });
  return state.kind === "closed" ? state.reason : state.kind;
}

/** Адрес базы e2e для чтения; не база нового интерфейса — отказ до первого запроса (тот же разбор, что у пересева). */
function readableDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? "";
  try {
    assertSafeDatabase(url);
  } catch (e) {
    throw new Error("Чтение базы e2e отказано: E2E_DATABASE_URL должна указывать на базу «senim_v2web_…».", { cause: e });
  }
  return url;
}

/** Предложения по заявкам покупателя с номером телефона `phone` (в виде «+7…»), по времени заявки и отклика. */
export async function buyerOffers(phone: string): Promise<BuyerOffer[]> {
  const client = new Client({ connectionString: readableDatabaseUrl() });
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
      rounds: { id: string; party: Round["party"]; status: Round["status"]; amount: string }[] | null;
    }>(
      `select r.id as request_id, o.id as offer_id, e."publicNumber" as public_number, o.status as offer_status,
              r.status as request_status, r."preContractFlow" is not null as pre_contract, d.id as deal_id,
              (select json_agg(json_build_object('id', p.id, 'party', p.party, 'status', p.status, 'amount', p."amountTiyn"::text)
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
      rounds: (row.rounds ?? []).map((p) => ({ id: p.id, party: p.party, status: p.status, amountTiyn: BigInt(p.amount) })),
    }));
  } finally {
    await client.end();
  }
}

/**
 * Предложение сида в нужном состоянии (и с условием `also`, например «есть история торга»). Нет — сид изменён прогоном flows (торг дошёл до сделки): сценарий падает с
 * понятным текстом, а не пропускается молча.
 */
export async function seedOffer(kind: OfferKind, also: (o: BuyerOffer) => boolean = () => true): Promise<BuyerOffer> {
  const found = (await buyerOffers(SEED_BUYER.phone)).find((o) => kindOf(o) === kind && also(o));
  if (!found) throw new Error(`В базе e2e нет предложения в состоянии «${kind}»: сид изменён прогоном flows — нужен пересев (E2E_FLOWS=1).`);
  return found;
}

export const offerPath = (o: Pick<BuyerOffer, "requestId" | "offerId">): string => `/v2/requests/${o.requestId}/offers/${o.offerId}`;

/**
 * Вход засеянным покупателем через identity (`/v2/login`, код с экрана) — один раз на файл сценариев: состояние входа
 * (cookie) сохраняется во временной папке ОС и подключается к контекстам (`storageState`). У стенда лимит кодов на номер;
 * при «Слишком много запросов кода» сценарий падает (повторять вход бессмысленно — лимиты сбрасывает стенд).
 */
export async function seedBuyerState(browser: Browser, baseURL: string | undefined, file: string): Promise<string> {
  const target = path.join(tmpdir(), "senim-e2e-v2", file);
  mkdirSync(path.dirname(target), { recursive: true });
  const options: BrowserContextOptions = { baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty" };
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await loginV2(page, SEED_BUYER.phone);
    await passOnboarding(page);
    await context.storageState({ path: target });
  } finally {
    await context.close();
  }
  return target;
}
