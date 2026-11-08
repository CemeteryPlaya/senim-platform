import Link from "next/link";
import { ru } from "@/i18n/ru";
import { StatusBadge } from "@/ui";

const t = ru.companies.dealPortfolio;

/** Пометка работы из сделки: «Выполнено на Сенім», разрешение заказчика и ссылка на сделку. */
export function FromDealNote({ dealId, dealNumber, consent }: { dealId: string; dealNumber: number; consent: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-sunken p-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="success">{t.badges.fromDeal}</StatusBadge>
        {!consent && <StatusBadge tone="warning">{t.badges.waitingConsent}</StatusBadge>}
      </div>
      <p className="text-base text-ink">{consent ? t.panel.consentOk : t.panel.waitingConsent}</p>
      <Link href={`/deals/${dealId}`} className="inline-flex min-h-control-sm items-center self-start text-base font-semibold text-primary underline underline-offset-4">
        {ru.deal.number(dealNumber)}
      </Link>
    </div>
  );
}
