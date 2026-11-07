import type { Metadata } from "next";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { getIncomingRequest, TZ_PATH, wholeKzt, type IncomingRequest } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Container, Money, PageHeader, StatusBadge, formatDate, formatDateTime, formatDays, formatMoney, formatMonths } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { ActionButton } from "@/app/requests/_parts/ActionButton";
import { orNotFound, pageUser } from "@/app/requests/_parts/guard";
import { MEASUREMENT_TONE, OFFER_TONE, termsText } from "@/app/requests/_parts/labels";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { Negotiation } from "@/app/_components/negotiation/Negotiation";
import { detailRows, FactList } from "@/app/requests/_parts/RequestFacts";
import { executorNoDealAction, withdrawOfferAction } from "../actions";
import { CompleteForm, OfferForm, ScheduleForm } from "../ExecutorForms";
import { NoAccess } from "@/app/_components/NoAccess";
import { FlowSteps } from "@/app/_components/pre-contract/FlowSteps";
import { SizesBasis, siteRows } from "@/app/_components/pre-contract/SizesBasis";
import { illustrationFor } from "@/app/_home/illustration";
import { DepositExecutor, ExecutorProject } from "./PreContractExecutor";

const t = ru.requests.executorRequest;
const f = ru.requests.facts;
const x = ru.executor.request;

export const metadata: Metadata = { title: t.metaTitle };

/** Заявка уже ушла в оферту или закрыта: зеркальный блок «деньги будут зарезервированы» больше не нужен. */
const AFTER_OFFER = new Set(["CONTRACTING", "CLOSED", "CANCELLED"]);

/**
 * Заявка для мастера: что нужно заказчику и следующий шаг. На пути ТЗ — отклик, затем торг над чатом
 * («Принять N ₸» → оферта); в сценарии до договора (флаг preContractFlows) — замер, итоговая цена, проект.
 * До оферты — зеркальный блок денег (ТЗ п. 4.2): деньги покупателя будут зарезервированы в банке до начала работ.
 */
export default async function ExecutorRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser("EXECUTOR", `/executor/requests/${id}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const r = await orNotFound(getIncomingRequest(user, id));

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader
        back={{ href: "/executor/requests", label: ru.requests.incoming.title }}
        title={ru.requests.requestTitle(r.number, r.title)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {r.segment && <StatusBadge tone="info">{SEGMENT_NAMES[r.segment]}</StatusBadge>}
            {r.mode === "DIRECT" && <StatusBadge tone="accent">{ru.requests.mode.DIRECT}</StatusBadge>}
            {r.pre && <SizesBasis pre={r.pre} />}
          </span>
        }
        className="pb-0"
      />
      {r.pre && <FlowSteps flow={r.pre.flow} steps={r.pre.steps} current={r.pre.current} />}
      {!AFTER_OFFER.has(r.status) && (
        <p className="flex items-start gap-3 rounded-card bg-sunken p-4 text-base font-semibold text-ink">
          <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          {ru.payments.block.masterBeforePayment}
        </p>
      )}

      {/* Телефон: фото и факты, затем следующий шаг, затем подробности. Компьютер: шаг — справа во всю высоту. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[auto_1fr] lg:gap-x-8">
        <div className="flex min-w-0 flex-col gap-6">
          <Gallery title={r.title} photos={r.photos} />
        </div>

        <section aria-labelledby="next-step" className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 id="next-step" className="text-xl font-bold text-ink">
            {t.offerTitle}
          </h2>
          <NextStep r={r} />
        </section>

        <section aria-labelledby="request-facts" className="flex min-w-0 flex-col gap-4 self-start border-t border-line pt-6 lg:col-start-1">
          <h2 id="request-facts" className="text-xl font-bold text-ink">
            {ru.requests.request.detailsTitle}
          </h2>
          <FactList
            rows={[
              ...detailRows({ title: r.title, style: r.style, details: r.details }),
              ...(r.pre ? siteRows(r.pre) : []),
              { label: f.city, value: r.city },
              { label: f.address, value: r.address ?? <span className="text-muted">{f.addressHidden}</span> },
              ...(r.location ? [{ label: f.location, value: f.locationValue(r.location.lat.toFixed(5), r.location.lng.toFixed(5)) }] : []),
              ...(r.desiredDate ? [{ label: f.desiredDate, value: formatDate(r.desiredDate) }] : []),
              ...(r.wishes ? [{ label: f.wishes, value: r.wishes }] : []),
            ]}
          />
        </section>
      </div>

      {/* Торг — над чатом отклика (ТЗ п. 9): раунды цены и смета «Сумма заказа · Гарантия оплаты · К выплате». */}
      {r.myOffer && r.path === TZ_PATH && <Negotiation offerId={r.myOffer.id} />}
      {r.myOffer && <OfferChat offerId={r.myOffer.id} />}
    </Container>
  );
}

/** Фото помещения крупно (макет 13): первое — во всю ширину, остальные — рядом. Нет фото — иллюстрация вида мебели. */
function Gallery({ title, photos }: { title: string; photos: IncomingRequest["photos"] }) {
  if (photos.length === 0) {
    const src = illustrationFor(title);
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element -- иллюстрация из public/img
      <img src={src} alt={x.illustration} className="aspect-[16/9] w-full rounded-card border border-line bg-sunken object-cover" />
    ) : null;
  }
  const [first, ...rest] = photos;
  return (
    <ul aria-label={x.photosLabel} className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] gap-3">
      <li className="col-span-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- фото из хранилища */}
        <img src={first!.src} alt={x.photoAlt(1)} className="aspect-[4/3] w-full rounded-card border border-line bg-sunken object-cover sm:aspect-[16/9]" />
      </li>
      {rest.map((p, i) => (
        <li key={p.id}>
          {/* eslint-disable-next-line @next/next/no-img-element -- фото из хранилища */}
          <img src={p.src} alt={x.photoAlt(i + 2)} loading="lazy" className="aspect-square w-full rounded-control border border-line bg-sunken object-cover" />
        </li>
      ))}
    </ul>
  );
}

function OfferSummary({ offer, tz }: { offer: NonNullable<IncomingRequest["myOffer"]>; tz: boolean }) {
  const o = ru.requests.offer;
  const rows: [string, ReactNode][] = [
    [tz ? t.myPrice : o.price, <Money key="p" amount={wholeKzt(offer.priceTiyn)} className="font-semibold" />],
    [o.duration, formatDays(offer.durationDays)],
    [o.warranty, formatMonths(offer.warrantyMonths)],
    ...(tz ? [] : ([[o.measurement, termsText(offer.measurementTerms, offer.measurementFee)]] as [string, ReactNode][])),
  ];
  // Строки «подпись — значение»: длинное значение переносится под подпись, а не сжимается в узкий столбец.
  return (
    <dl className="flex flex-col divide-y divide-line text-base">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
          <dt className="text-muted">{label}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Один следующий шаг исполнителя по состоянию его отклика и замера. */
function NextStep({ r }: { r: IncomingRequest }) {
  const offer = r.myOffer;
  const tz = r.path === TZ_PATH;
  if (!offer) {
    return r.canOffer ? (
      <div className="rounded-card border border-line p-5 sm:p-6">
        <OfferForm requestId={r.id} defaults={r.defaults} tz={tz} />
      </div>
    ) : (
      <Alert tone="info">{ru.requests.status[r.status]}</Alert>
    );
  }
  const m = offer.measurement;
  const card = (children: ReactNode) => (
    <div className="flex flex-col gap-4 rounded-card border border-line p-5 sm:p-6">
      <StatusBadge tone={m ? MEASUREMENT_TONE[m.status] : OFFER_TONE[offer.status]}>
        {m ? ru.requests.measurementStatus[m.status] : ru.requests.offerStatus[offer.status]}
      </StatusBadge>
      <OfferSummary offer={offer} tz={tz} />
      {children}
    </div>
  );

  if (offer.status === "SENT") {
    return card(
      <>
        <Alert tone="success" title={t.sentTitle}>
          {tz ? t.sentTextTz : t.sentText}
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
        <div className="rounded-card border border-line p-5 sm:p-6">
          <OfferForm requestId={r.id} defaults={r.defaults} tz={tz} />
        </div>
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
        <Alert tone="success" action={<ButtonLink href={offer.dealId ? `/deals/${offer.dealId}` : "/deals"}>{t.openOffer}</ButtonLink>}>
          {t.contractingText}
        </Alert>
        {/* «Договор до замера»: проект — уже по договору, цена в пределах допуска. */}
        {r.pre && !r.pre.rules.projectBeforeContract && <ExecutorProject pre={r.pre} offer={offer} />}
      </>,
    );
  }
  // Дальше — только шаги сценария до договора (флаг preContractFlows).
  if (!r.pre) return card(<p className="text-base text-ink-soft">{ru.requests.status[r.status]}</p>);
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
