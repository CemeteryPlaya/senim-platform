import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { requireUser } from "@/modules/identity";
import { getNegotiation, type NegotiationView } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { Alert, ButtonLink, cn, DateText, StatusBadge, type Tone } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { NegotiationActions } from "./NegotiationActions";

const t = ru.requests.negotiation;

export type NegotiationProps = {
  /** Отклик, по которому идёт торг: тот же, к которому привязан чат (OfferChat). */
  offerId: string;
  /** id секции — якорь для ссылки «#price». */
  id?: string;
  className?: string;
};

const STATUS_TONE: Record<NegotiationView["rounds"][number]["status"], Tone> = {
  PROPOSED: "info",
  SUPERSEDED: "neutral",
  WITHDRAWN: "neutral",
  ACCEPTED: "success",
};

/**
 * Торг по отклику (ТЗ п. 9, решение 2.2.3) — встраивается над чатом отклика у покупателя и у мастера.
 * Сверху — что сейчас (цена другой стороны или «ждём ответа»), смета до оплаты по текущей цене (ТЗ п. 5:
 * покупателю — «Стоимость заказа · Защита сделки (2%) · Итого к оплате», мастеру — «Сумма заказа · Гарантия
 * оплаты · К выплате»), кнопки торга и раунды: кто, сколько, когда, статус. Чужой отклик — 404 страницы.
 *
 * Пример: <Negotiation offerId={offer.id} /> над <OfferChat offerId={offer.id} />.
 */
export async function Negotiation({ offerId, id = "price", className }: NegotiationProps) {
  const user = await requireUser("CLIENT", "EXECUTOR");
  const view = await getNegotiation(user, { offerId }).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("flex scroll-mt-24 flex-col gap-5 rounded-card border border-line p-5 sm:p-6", className)}>
      <div className="flex flex-col gap-2">
        <h2 id={headingId} className="text-xl font-bold text-ink">
          {t.title}
        </h2>
        {view.live && <p className="text-base text-ink-soft">{t.lead}</p>}
      </div>
      <Now view={view} />
      <Estimate view={view} />
      {view.live && (
        <NegotiationActions
          offerId={view.offerId}
          party={view.party}
          accept={view.can.accept && view.open ? { proposalId: view.open.id, amount: formatTiyn(view.open.amountTiyn) } : null}
          withdrawId={view.can.withdraw && view.open ? view.open.id : null}
          canPropose={view.can.propose}
        />
      )}
      {view.rounds.length > 0 && <Rounds view={view} />}
    </section>
  );
}

/** Что сейчас: цена принята, цена другой стороны ждёт ответа, своя ждёт ответа, торг закрыт. */
function Now({ view }: { view: NegotiationView }) {
  if (view.dealId) {
    return (
      <Alert tone="success" action={<ButtonLink href={`/deals/${view.dealId}`}>{t.openDeal}</ButtonLink>}>
        {t.accepted(formatTiyn(view.priceTiyn))}
      </Alert>
    );
  }
  if (!view.live) return <Alert tone="info">{t.closed}</Alert>;
  if (!view.open) return <p className="text-base text-ink-soft">{t.noOpen}</p>;
  if (view.open.mine) return <p className="text-lg font-semibold text-ink">{t.waitingOther}</p>;
  return <p className="text-2xl font-extrabold break-words text-ink">{t.theirPrice(t.party[view.open.party], formatTiyn(view.open.amountTiyn))}</p>;
}

/** Смета стороны до оплаты (ТЗ п. 5): суммы и проценты видны заранее. Расчёт — payments.partyEstimate. */
function Estimate({ view }: { view: NegotiationView }) {
  const labels = ru.payments.estimate[view.party];
  const rows = [
    { label: labels.price, value: view.estimate.priceTiyn },
    { label: labels.extra, value: view.estimate.extraTiyn },
  ];
  return (
    <section aria-label={t.estimateTitle} className="flex flex-col gap-2 rounded-control bg-sunken p-4">
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 text-base">
            <dt className="text-ink-soft">{r.label}</dt>
            <dd className="font-semibold text-ink">{formatTiyn(r.value)}</dd>
          </div>
        ))}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line pt-2 text-lg">
          <dt className="font-bold text-ink">{labels.total}</dt>
          <dd className="font-extrabold text-ink">{formatTiyn(view.estimate.totalTiyn)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Раунды торга по порядку: кто предложил, сумма, когда, статус. */
function Rounds({ view }: { view: NegotiationView }) {
  return (
    <details className="group" open={view.rounds.length <= 3}>
      <summary className="flex min-h-control-sm cursor-pointer items-center text-lg font-bold text-primary">{t.rounds}</summary>
      <ol className="mt-3 flex flex-col divide-y divide-line border-y border-line">
        {view.rounds.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-base">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold text-ink">{r.mine ? t.you : t.party[r.party]}</span>
              <DateText value={r.createdAt} format="dateTime" className="text-sm text-muted" />
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-ink">{formatTiyn(r.amountTiyn)}</span>
              <StatusBadge tone={STATUS_TONE[r.status]}>{t.status[r.status]}</StatusBadge>
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
