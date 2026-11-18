import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { Client } from "pg";
import { assertSafeDatabase } from "./safe-database";
import { loginV2, passOnboarding } from "./support";

/**
 * Профили мастеров, приглашения и история покупателя — чтение базы e2e (E2E_DATABASE_URL, только «senim_v2web_*») для
 * сценариев: публичные номера мастеров, засеянная оконченная сделка Айгерим, ожидаемые числа профиля. Только SELECT:
 * данные меняют сами сценарии через интерфейс. Числа считаются по тем же правилам, что и модули (спека 2026-11-17, 3.7–3.8):
 * сделка — с заключённой офертой (`signedAt`), оконченная — SPLIT_PAYOUT, CANCELLED, REFUNDED, успешная — SPLIT_PAYOUT.
 */

/** Засеянные мастера (src/seed/data.ts): Ким и Ерлан — «Комфорт», Тимур — «Эконом», Qazaq Wood — мастер сделки Айгерим. */
export const MASTERS = { erlan: "+77000000201", kim: "+77000000203", timur: "+77000000204", qazaq: "+77000000206" } as const;

/** Улицы адресов покупателей сида (ADDR в src/seed/data.ts): ни одна не должна попасть на публичную страницу мастера. */
export const SEED_STREETS = /Сыганак|Примерный|Образцовая|Тестовый-2|Макетная|Условный|Пробная|Шаблонная|Черновой|кв\.\s?\d/;

function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? "";
  try {
    assertSafeDatabase(url);
  } catch (e) {
    throw new Error("Чтение базы e2e отказано: E2E_DATABASE_URL должна указывать на базу «senim_v2web_…».", { cause: e });
  }
  return url;
}

async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** «Исполнитель №N» мастера по телефону его аккаунта. */
export async function publicNumberOf(phone: string): Promise<number> {
  const rows = await query<{ n: number }>(`select e."publicNumber" as n from "ExecutorProfile" e join "User" u on u.id = e."userId" where u.phone = $1`, [phone]);
  const n = rows[0]?.n;
  if (n === undefined) throw new Error(`Мастера ${phone} нет в базе e2e — нужен пересев (E2E_FLOWS=1)`);
  return n;
}

/** Номер заявки (как на экране: «Заявка №N»). */
export async function requestNumberOf(requestId: string): Promise<number> {
  const rows = await query<{ n: number }>(`select number as n from "Request" where id = $1`, [requestId]);
  const n = rows[0]?.n;
  if (n === undefined) throw new Error(`Заявки ${requestId} нет в базе e2e`);
  return n;
}

/** Приглашения заявки: публичный номер мастера → статус и причина отказа. */
export async function invitationsOf(requestId: string): Promise<Map<number, { status: string; reason: string | null }>> {
  const rows = await query<{ n: number; status: string; reason: string | null }>(
    `select e."publicNumber" as n, i.status, i.reason from "RequestInvitation" i join "ExecutorProfile" e on e.id = i."executorId" where i."requestId" = $1`,
    [requestId],
  );
  return new Map(rows.map((r) => [r.n, { status: r.status, reason: r.reason }]));
}

/** Засеянная оконченная сделка Айгерим («Гостиная и ТВ-зона», PROFILE_REQUESTS сида): её мастер, отзыв и выбор показа. */
export type ProfileDeal = { dealId: string; title: string; publicNumber: number; status: string; reviewed: boolean; showcased: boolean };

export async function seedProfileDeal(buyerPhone: string): Promise<ProfileDeal> {
  const rows = await query<{ id: string; title: string; n: number; status: string; reviewed: boolean; showcased: boolean }>(
    `select d.id, d.title, e."publicNumber" as n, d.status,
            exists(select 1 from "Review" r where r."dealId" = d.id) as reviewed,
            exists(select 1 from "DealShowcase" s where s."dealId" = d.id) as showcased
       from "Deal" d
       join "Request" q on q.id = d."requestId"
       join "User" u on u.id = q."clientId"
       join "FurnitureType" f on f.id = q."furnitureTypeId"
       join "ExecutorProfile" e on e.id = d."executorId"
      where u.phone = $1 and f.slug = 'living-room'`,
    [buyerPhone],
  );
  const row = rows[0];
  if (!row) throw new Error("В базе e2e нет засеянной сделки Айгерим «Гостиная и ТВ-зона» — нужен пересев (E2E_FLOWS=1)");
  return { dealId: row.id, title: row.title, publicNumber: row.n, status: row.status, reviewed: row.reviewed, showcased: row.showcased };
}

/** Счётчики профиля покупателя: заказы (кроме черновиков), сделки с офертой, успешные; число строк истории. */
export async function buyerCounts(phone: string): Promise<{ orders: number; deals: number; successful: number }> {
  const rows = await query<{ orders: string; deals: string; successful: string }>(
    `select count(*)::text as orders,
            count(d.id) filter (where d."signedAt" is not null)::text as deals,
            count(d.id) filter (where d.status = 'SPLIT_PAYOUT')::text as successful
       from "Request" r
       join "User" u on u.id = r."clientId"
       left join "Deal" d on d."requestId" = r.id
      where u.phone = $1 and r.status <> 'DRAFT'`,
    [phone],
  );
  const row = rows[0];
  return { orders: Number(row?.orders ?? 0), deals: Number(row?.deals ?? 0), successful: Number(row?.successful ?? 0) };
}

export type MasterNumbers = { publicNumber: number; deals: number; ended: number; successful: number; successRate: number | null };

const MASTER_NUMBERS = `
  select e."publicNumber" as n,
         count(d.id) filter (where d."signedAt" is not null)::text as deals,
         count(d.id) filter (where d."signedAt" is not null and d.status in ('SPLIT_PAYOUT', 'CANCELLED', 'REFUNDED'))::text as ended,
         count(d.id) filter (where d."signedAt" is not null and d.status = 'SPLIT_PAYOUT')::text as successful
    from "ExecutorProfile" e
    join "User" u on u.id = e."userId"
    left join "Deal" d on d."executorId" = e.id
   where e.status = 'APPROVED' and u."blockedAt" is null`;

function numbersOf(row: { n: number; deals: string; ended: string; successful: string }): MasterNumbers {
  const ended = Number(row.ended);
  const successful = Number(row.successful);
  return { publicNumber: row.n, deals: Number(row.deals), ended, successful, successRate: ended ? Math.round((successful / ended) * 100) : null };
}

/** Числа одобренного мастера: сделки с офертой, оконченные, успешные и доля успешных (как `executorStats`). */
export async function masterNumbers(publicNumber: number): Promise<MasterNumbers> {
  const rows = await query<{ n: number; deals: string; ended: string; successful: string }>(`${MASTER_NUMBERS} and e."publicNumber" = $1 group by e."publicNumber"`, [publicNumber]);
  if (!rows[0]) throw new Error(`Одобренного мастера №${publicNumber} нет в базе e2e`);
  return numbersOf(rows[0]);
}

/** Одобренный мастер со сделками, но без оконченных: у него доля успешных не показывается. */
export async function masterWithoutEnded(): Promise<MasterNumbers> {
  const rows = await query<{ n: number; deals: string; ended: string; successful: string }>(`${MASTER_NUMBERS} group by e."publicNumber" order by e."publicNumber"`);
  const found = rows.map(numbersOf).find((m) => m.deals > 0 && m.ended === 0);
  if (!found) throw new Error("В базе e2e нет мастера со сделками без оконченных (в сиде — «Ағаш Шебер») — нужен пересев (E2E_FLOWS=1)");
  return found;
}

/** Вход засеянным человеком через identity: состояние входа — во временной папке ОС (как `seedBuyerState` в offers.ts). */
export async function personState(browser: Browser, baseURL: string | undefined, phone: string, file: string): Promise<string> {
  const target = path.join(tmpdir(), "senim-e2e-v2", file);
  mkdirSync(path.dirname(target), { recursive: true });
  const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  try {
    const page = await context.newPage();
    await loginV2(page, phone);
    await passOnboarding(page);
    await context.storageState({ path: target });
  } finally {
    await context.close();
  }
  return target;
}
