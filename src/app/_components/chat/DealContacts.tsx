import { dealContacts } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";
import { PartyContacts } from "./PartyContacts";

export type DealContactsProps = { dealId: string; className?: string };

/**
 * «Контакты другой стороны» для экрана сделки (серверный компонент). Сторона сделки после заключения
 * оферты видит телефон и Instagram другой стороны; до оферты, оператору и чужим — ничего (блока нет).
 * Права проверяет companies.dealContacts; чужую сделку экран сделки отсекает сам, здесь NOT_FOUND — пустой блок.
 *
 * Пример: <DealContacts dealId={deal.id} /> в карточке сделки над чатом.
 */
export async function DealContacts({ dealId, className }: DealContactsProps) {
  const user = await requireUser();
  const contacts = await dealContacts(user, dealId).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  });
  return contacts ? <PartyContacts contacts={contacts} className={className} /> : null;
}
