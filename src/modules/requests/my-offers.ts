import "server-only";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { loadExecutor, requestTitle } from "./access";
import { coverPhoto, coversOf } from "./covers";

/**
 * «Мои отклики» исполнителя (макет 14): его отклики по любым заявкам — и открытым, и уже закрытым для
 * других (выбран, отклонён, отозван), новые сверху. Адрес заказчика здесь не раскрывается — он на экране
 * заявки после выбора отклика.
 */
export async function listMyOffers(user: CurrentUser) {
  const executor = await loadExecutor(db, user);
  const rows = await db.offer.findMany({
    where: { executorId: executor.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    include: {
      measurement: { select: { status: true, scheduledAt: true, finalPrice: true } },
      deal: { select: { id: true } },
      request: {
        select: { id: true, number: true, status: true, segment: true, city: true, customType: true, furnitureType: { select: { name: true } }, photos: coverPhoto },
      },
    },
  });
  const cover = await coversOf(rows.map((o) => o.request));
  return rows.map((o) => ({
    id: o.id,
    requestId: o.request.id,
    number: o.request.number,
    title: requestTitle(o.request),
    city: o.request.city,
    segment: o.request.segment,
    requestStatus: o.request.status,
    cover: cover(o.request),
    status: o.status,
    priceTiyn: o.priceTiyn,
    durationDays: o.durationDays,
    createdAt: o.createdAt,
    measurement: o.measurement,
    dealId: o.deal?.id ?? null,
  }));
}
export type MyOfferItem = Awaited<ReturnType<typeof listMyOffers>>[number];
