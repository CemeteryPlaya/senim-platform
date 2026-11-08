import type { IncomingListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { RequestCard, StatusBadge, formatRelative } from "@/ui";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { OFFER_TONE } from "@/app/requests/_parts/labels";
import { illustrationFor } from "@/app/_home/illustration";

const x = ru.executor.incoming;

/** Карточка входящей заявки: «Новая» — пока нет отклика мастера; иначе — статус его отклика. */
export function IncomingCard({ r }: { r: IncomingListItem }) {
  const style = r.style ? (STYLES[r.style as StyleKey]?.name ?? r.style) : null;
  return (
    <RequestCard
      className="flex-1"
      href={`/executor/requests/${r.id}`}
      thumbUrl={r.cover?.src ?? illustrationFor(r.title)}
      title={ru.requests.requestTitle(r.number, r.title)}
      isNew={r.myOfferStatus === null}
      badges={
        <>
          {r.mode === "DIRECT" && <StatusBadge tone="accent">{x.direct}</StatusBadge>}
          {r.myOfferStatus && <StatusBadge tone={OFFER_TONE[r.myOfferStatus]}>{x.myOffer(ru.requests.offerStatus[r.myOfferStatus].toLowerCase())}</StatusBadge>}
        </>
      }
      meta={[...(style ? [r.city, style] : [r.city]), ...(r.publishedAt ? [formatRelative(r.publishedAt)] : [])]}
      offersCount={r.offersCount}
    />
  );
}
