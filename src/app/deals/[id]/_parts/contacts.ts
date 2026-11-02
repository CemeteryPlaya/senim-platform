import "server-only";
import type { DealView } from "@/modules/deal-core";
import { formatPhone } from "@/modules/identity";
import { db } from "@/platform/db";

export type PartyContacts = { phone: string; instagram: string | null };

/**
 * Контакты другой стороны сделки (ТЗ п. 3, ADR-009 раздел 7): видны обеим сторонам только после заключения
 * оферты (`signedAt`); до неё и оператору здесь — ничего. Доступ к сделке уже проверил getDealView.
 * INTEGRATOR: заменить на `dealContacts(user, dealId)` от idco-агента (модуль identity/companies) и удалить файл.
 */
export async function otherPartyContacts(deal: DealView): Promise<PartyContacts | null> {
  if (deal.dates.signedAt === null || (deal.viewer !== "CLIENT" && deal.viewer !== "EXECUTOR")) return null;
  const row = await db.deal.findUnique({
    where: { id: deal.id },
    select: { client: { select: { phone: true, instagram: true } }, executor: { select: { user: { select: { phone: true, instagram: true } } } } },
  });
  if (!row) return null;
  const other = deal.viewer === "CLIENT" ? row.executor.user : row.client;
  return { phone: formatPhone(other.phone), instagram: other.instagram };
}
