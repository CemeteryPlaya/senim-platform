import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { assertOperator } from "./access";

const HOUR = 3_600_000;

/**
 * Открытые заявки, которые ждут дольше `hours` часов и не имеют активного отклика
 * (SENT или ACCEPTED). Отклонённые отклики считаются: заявка после «замер без сделки» снова ждёт.
 */
export async function listStaleRequests(user: CurrentUser, input: { hours: number }, now = new Date()) {
  assertOperator(user);
  const rows = await db.request.findMany({
    where: {
      status: "OPEN",
      publishedAt: { lte: new Date(now.getTime() - input.hours * HOUR) },
      offers: { none: { status: { in: ["SENT", "ACCEPTED"] } } },
    },
    orderBy: { publishedAt: "asc" },
    select: {
      id: true,
      number: true,
      mode: true,
      segment: true,
      customType: true,
      publishedAt: true,
      furnitureType: { select: { name: true } },
      client: { select: { fullName: true, phone: true } },
      _count: { select: { offers: { where: { status: "DECLINED" } } } },
    },
  });
  return rows.map(({ _count, publishedAt, ...r }) => ({
    ...r,
    publishedAt: publishedAt!,
    declinedOffers: _count.offers,
    waitingHours: Math.floor((now.getTime() - publishedAt!.getTime()) / HOUR),
  }));
}
