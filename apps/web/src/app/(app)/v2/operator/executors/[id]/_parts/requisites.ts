import type { LegalForm } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";

const q = ru.app.operatorQueues;
const r = q.executors.card.requisites;

export type RequisitesInput = {
  legalForm: LegalForm;
  legalName: string;
  binIinLast4: string;
  signerFullName: string | null;
  payoutIbanLast4: string | null;
};

export type RequisiteRow = { label: string; value: string; numeric?: true };

/**
 * Реквизиты исполнителя для сверки оператором (решение владельца 22.11.2026): название, форма, ИИН/БИН, подписант оферты
 * и счёт для оплаты. Номера — только последние 4 символа (инвариант ПДн, ADR-014); полные значения — в оферте и расписке.
 */
export function requisitesOf(x: RequisitesInput): RequisiteRow[] {
  return [
    { label: r.legalName, value: x.legalName },
    { label: r.legalForm, value: q.legalForms[x.legalForm] },
    { label: r.binIin, value: q.masked(x.binIinLast4), numeric: true },
    { label: r.signer, value: x.signerFullName || q.none },
    x.payoutIbanLast4 ? { label: r.iban, value: q.masked(x.payoutIbanLast4), numeric: true } : { label: r.iban, value: r.ibanMissing },
  ];
}
