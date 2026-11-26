import "server-only";
import type { DealStatus } from "@/generated/prisma/enums";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { db, transaction, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { parseInput } from "@/platform/validation";
import { requireClient } from "./access";
import { dealAddressSchema, pointOf, type GeoPoint } from "./schema";

/**
 * Адрес сделки (ADR-016): указывает покупатель на своей сделке, пока она не окончена; хранится в колонках заявки этой
 * сделки (`Request.address`, `addressLat`, `addressLng` — одна заявка, одна сделка). Мастер видит его после заключения
 * оферты через `getIncomingRequest` (адрес — мастеру выбранного отклика). Чужая сделка — «не найдена», мастер — отказ.
 */

const e = ru.requests.errors;

/** Сделка окончена: адрес больше не меняется. */
const ENDED: ReadonlySet<DealStatus> = new Set(["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"]);

export type DealAddress = { address: string | null; location: GeoPoint | null };

type DealRow = { requestId: string; clientId: string; status: DealStatus };

/** Своя сделка покупателя; `lock` — строка сделки блокируется до конца транзакции (смена статуса ждёт записи адреса). */
async function ownDeal(tx: Db, user: CurrentUser, dealId: string, lock: boolean): Promise<DealRow> {
  const [row] = lock
    ? await tx.$queryRaw<DealRow[]>`SELECT "requestId", "clientId", "status" FROM "Deal" WHERE "id" = ${dealId} FOR UPDATE`
    : [await tx.deal.findUnique({ where: { id: dealId }, select: { requestId: true, clientId: true, status: true } })];
  if (!row || row.clientId !== user.id) return fail.notFound(e.dealNotFound);
  return row;
}

/**
 * «Сохранить адрес»: строка адреса и необязательная точка. Только покупатель этой сделки и только пока сделка не окончена.
 * Запись и аудит `request.address.set` (в истории сделки) — одной транзакцией. Повтор с тем же адресом и точкой ничего
 * не пишет.
 */
export async function setDealAddress(user: CurrentUser, dealId: string, input: { address: string; location?: GeoPoint | null }): Promise<void> {
  requireClient(user);
  const { address, location } = parseInput(dealAddressSchema, { dealId, ...input });
  await transaction(async (tx) => {
    const deal = await ownDeal(tx, user, dealId, true);
    if (ENDED.has(deal.status)) fail.conflict(e.dealEnded);
    const before = await tx.request.findUniqueOrThrow({ where: { id: deal.requestId }, select: { address: true, addressLat: true, addressLng: true } });
    const point = pointOf(before);
    if (before.address === address && point?.lat === location?.lat && point?.lng === location?.lng) return;
    // Точка — обе координаты или ни одной (CHECK в БД); без точки прежняя стирается.
    await tx.request.update({ where: { id: deal.requestId }, data: { address, addressLat: location?.lat ?? null, addressLng: location?.lng ?? null } });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "request.address.set",
      entity: { type: "request", id: deal.requestId },
      scope: `deal:${dealId}`,
      meta: { location: location !== null, changed: before.address !== null },
    });
  });
}

/** Адрес своей сделки для покупателя (экран адреса и карточка сделки); не указан — `null` в полях. */
export async function getDealAddress(user: CurrentUser, dealId: string): Promise<DealAddress> {
  requireClient(user);
  const deal = await ownDeal(db, user, dealId, false);
  const r = await db.request.findUniqueOrThrow({ where: { id: deal.requestId }, select: { address: true, addressLat: true, addressLng: true } });
  return { address: r.address, location: pointOf(r) };
}
