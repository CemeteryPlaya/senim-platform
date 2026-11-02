import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getIncomingRequest, type IncomingRequest } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Container, Money, PageHeader, StatusBadge, formatDate, formatDateTime, formatDays, formatMoney, formatMonths } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { ActionButton } from "@/app/requests/_parts/ActionButton";
import { orNotFound, pageUser } from "@/app/requests/_parts/guard";
import { MEASUREMENT_TONE, OFFER_TONE, termsText } from "@/app/requests/_parts/labels";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { detailRows, FactList } from "@/app/requests/_parts/RequestFacts";
import { executorNoDealAction, withdrawOfferAction } from "../actions";
import { CompleteForm, OfferForm, ScheduleForm } from "../ExecutorForms";
import { NoAccess } from "@/app/_components/NoAccess";
import { FlowSteps } from "@/app/_components/pre-contract/FlowSteps";
import { SizesBasis, siteRows } from "@/app/_components/pre-contract/SizesBasis";
import { DepositExecutor, ExecutorProject } from "./PreContractExecutor";

const t = ru.requests.executorRequest;
const f = ru.requests.facts;

export const metadata: Metadata = { title: t.metaTitle };

/** Заявка для исполнителя: что нужно заказчику и следующий шаг (отклик, замер, итоговая цена). */
export default async function ExecutorRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser("EXECUTOR", `/executor/requests/${id}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const r = await orNotFound(getIncomingRequest(user, id));

  return (
    <Container className="flex flex-col gap-8 pb-10">
      <PageHeader
        back={{ href: "/executor/requests", label: ru.requests.incoming.title }}
        title={ru.requests.requestTitle(r.number, r.title)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {r.segment && <StatusBadge>{SEGMENT_NAMES[r.segment]}</StatusBadge>}
            {r.mode === "DIRECT" && <StatusBadge tone="accent">{ru.requests.mode.DIRECT}</StatusBadge>}
            <SizesBasis pre={r.pre} />
          </span>
        }
      />
      <FlowSteps flow={r.pre.flow} steps={r.pre.steps} current={r.pre.current} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-labelledby="request-facts" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
          <h2 id="request-facts" className="text-xl font-bold text-ink">
            {ru.requests.request.detailsTitle}
          </h2>
          <FactList
            rows={[
              ...detailRows({ title: r.title, style: r.style, details: r.details }),
              ...siteRows(r.pre),
              { label: f.city, value: r.city },
              { label: f.address, value: r.address ?? <span className="text-muted">{f.addressHidden}</span> },
              ...(r.desiredDate ? [{ label: f.desiredDate, value: formatDate(r.desiredDate) }] : []),
              ...(r.wishes ? [{ label: f.wishes, value: r.wishes }] : []),
            ]}
          />
          {r.photos.length > 0 && (
            <ul aria-label={f.photos} className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-3">
              {r.photos.map((p, i) => (
                <li key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- фото из хранилища */}
                  <img src={p.src} alt={ru.requests.wizard.room.photoAlt(i + 1)} className="aspect-square w-full rounded-control border border-line object-cover" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="next-step" className="flex flex-col gap-4">
          <h2 id="next-step" className="text-xl font-bold text-ink">
            {t.offerTitle}
          </h2>
          <NextStep r={r} />
        </section>
      </div>

      {r.myOffer && (
        <OfferChat offerId={r.myOffer.id} />
      )}
    </Container>
  );
}

function OfferSummary({ offer }: { offer: NonNullable<IncomingRequest["myOffer"]> }) {
  const o = ru.requests.offer;
  return (
    <dl className="facts gap-x-4 gap-y-2 text-base">
      <dt className="text-muted">{o.price}</dt>
      <dd className="font-semibold text-ink">
        <Money amount={offer.price} />
      </dd>
      <dt className="text-muted">{o.duration}</dt>
      <dd className="text-ink">{formatDays(offer.durationDays)}</dd>
      <dt className="text-muted">{o.warranty}</dt>
      <dd className="text-ink">{formatMonths(offer.warrantyMonths)}</dd>
      <dt className="text-muted">{o.measurement}</dt>
      <dd className="text-ink">{termsText(offer.measurementTerms, offer.measurementFee)}</dd>
    </dl>
  );
}

/** Один следующий шаг исполнителя по состоянию его отклика и замера. */
function NextStep({ r }: { r: IncomingRequest }) {
  const offer = r.myOffer;
  if (!offer) {
    return r.canOffer ? <OfferForm requestId={r.id} defaults={r.defaults} /> : <Alert tone="info">{ru.requests.status[r.status]}</Alert>;
  }
  const m = offer.measurement;
  const card = (children: ReactNode) => (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      <StatusBadge tone={m ? MEASUREMENT_TONE[m.status] : OFFER_TONE[offer.status]}>
        {m ? ru.requests.measurementStatus[m.status] : ru.requests.offerStatus[offer.status]}
      </StatusBadge>
      <OfferSummary offer={offer} />
      {children}
    </div>
  );

  if (offer.status === "SENT") {
    return card(
      <>
        <Alert tone="success" title={t.sentTitle}>
          {t.sentText}
        </Alert>
        <ActionButton
          action={withdrawOfferAction}
          input={{ offerId: offer.id }}
          variant="ghost"
          confirm={{ title: t.withdrawConfirmTitle, text: t.withdrawConfirmText, yes: t.withdrawConfirm, no: t.keep, tone: "danger" }}
        >
          {t.withdraw}
        </ActionButton>
      </>,
    );
  }
  if (r.retryAllowed && r.canOffer) {
    return (
      <>
        <Alert tone="accent" title={ru.requests.pre.retry.allowedTitle}>
          {ru.requests.pre.retry.allowedText}
        </Alert>
        <OfferForm requestId={r.id} defaults={r.defaults} />
      </>
    );
  }
  if (offer.status === "WITHDRAWN") return card(<p className="text-base text-ink-soft">{t.withdrawnText}</p>);
  if (offer.status === "DECLINED") {
    return card(
      m?.status === "NO_DEAL" ? (
        <Alert tone="warning" title={t.noDealTitle}>
          {m.feeAccrued ? t.feeAccrued(formatMoney(m.feeAccrued)) : t.declinedText}
        </Alert>
      ) : (
        <p className="text-base text-ink-soft">{t.declinedText}</p>
      ),
    );
  }

  // ACCEPTED
  const noDeal = m && (m.status === "SCHEDULED" || m.status === "DONE") && r.status === "MEASURING" && (
    <ActionButton
      action={executorNoDealAction}
      input={{ measurementId: m.id, result: "" }}
      variant="ghost"
      confirm={{ title: t.noDealConfirmTitle, text: t.noDealConfirmText, yes: t.noDealConfirm, no: t.keep, tone: "danger" }}
    >
      {t.noDeal}
    </ActionButton>
  );
  if (r.status === "CONTRACTING" || r.status === "CLOSED") {
    return card(
      <>
        <Alert tone="success" action={<ButtonLink href="/deals">{ru.common.nav.deals}</ButtonLink>}>
          {t.contractingText}
        </Alert>
        {/* «Договор до замера»: проект — уже по договору, цена в пределах допуска. */}
        {!r.pre.rules.projectBeforeContract && <ExecutorProject pre={r.pre} offer={offer} />}
      </>,
    );
  }
  if (r.pre.current === "deposit") return card(<DepositExecutor pre={r.pre} offerId={offer.id} />);
  if (!m && r.pre.current === "measure") {
    return card(
      <>
        <Alert tone="accent" title={t.chosenTitle}>
          {t.chosenText}
        </Alert>
        <ScheduleForm offerId={offer.id} />
      </>,
    );
  }
  if (m?.status === "SCHEDULED") {
    return card(
      <>
        <p className="text-base font-semibold text-ink">{t.scheduledTitle(formatDateTime(m.scheduledAt))}</p>
        <CompleteForm measurementId={m.id} />
        {noDeal}
      </>,
    );
  }
  if (r.pre.current === "project") {
    return card(
      <>
        <ExecutorProject pre={r.pre} offer={offer} />
        {noDeal}
      </>,
    );
  }
  // Шаг договора: ждём согласия заказчика (проект утверждён или — в «договоре до замера» — сразу после выбора).
  return card(
    <>
      {r.pre.approvedProject ? (
        <ExecutorProject pre={r.pre} offer={offer} />
      ) : (
        <Alert tone="info" title={ru.requests.pre.agree.contractFirstTitle}>
          {ru.requests.pre.agree.executorWaitContract}
        </Alert>
      )}
      {noDeal}
    </>,
  );
}
