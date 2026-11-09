import type { Metadata } from "next";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { getIncomingRequest, TZ_PATH, wholeKzt, type IncomingRequest } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import {
  Alert,
  ButtonLink,
  Container,
  DetailColumns,
  KeyValueList,
  Money,
  PageHeader,
  StatusBadge,
  TrustNote,
  formatDate,
  formatDateTime,
  formatDays,
  formatMoney,
  formatMonths,
  formatRelative,
  type KeyValueRow,
} from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { ActionButton } from "@/app/requests/_parts/ActionButton";
import { orNotFound, pageUser } from "@/app/requests/_parts/guard";
import { MEASUREMENT_TONE, OFFER_TONE, termsText } from "@/app/requests/_parts/labels";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { Negotiation } from "@/app/_components/negotiation/Negotiation";
import { detailRows } from "@/app/requests/_parts/RequestFacts";
import { executorNoDealAction, withdrawOfferAction } from "../actions";
import { CompleteForm, OfferComposer, ScheduleForm } from "../ExecutorForms";
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
 * Заявка для мастера (макет master-screens, экран 2): фото → параметры «метка — значение» → поле цены с расчётом
 * «Вы получите после приёмки» → «Откликнуться» внизу. Десктоп — две колонки (DetailColumns): справа фото, параметры
 * и отклик, слева подробности. После отклика на месте формы — его состояние; на пути ТЗ ниже — торг над чатом
 * («Принять N ₸» → оферта); в сценарии до договора (флаг preContractFlows) — замер, итоговая цена, проект.
 * Контакты заказчика до оферты скрыты (адрес — только выбранному мастеру).
 */
export default async function ExecutorRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser("EXECUTOR", `/executor/requests/${id}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const r = await orNotFound(getIncomingRequest(user, id));
  const tz = r.path === TZ_PATH;
  // Форма отклика: откликов ещё не было или оператор разрешил новую попытку (№16).
  const composing = r.canOffer && (!r.myOffer || r.retryAllowed);

  // До оферты контакты скрыты и деньги ещё не в банке; после — обе строки не нужны (контакты — в сделке).
  const beforeOffer = !AFTER_OFFER.has(r.status);

  const aside = (
    <>
      <Cover title={r.title} photos={r.photos} />
      {beforeOffer && (
        <p className="flex items-start gap-2 text-base text-ink-soft">
          <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          {x.contactsHidden}
        </p>
      )}
      <KeyValueList rows={keyRows(r)} className="rounded-card border border-line bg-surface px-4 py-1" />
      {beforeOffer && <TrustNote>{ru.payments.block.masterBeforePayment}</TrustNote>}
      {composing && r.retryAllowed && (
        <Alert tone="accent" title={ru.requests.pre.retry.allowedTitle}>
          {ru.requests.pre.retry.allowedText}
        </Alert>
      )}
    </>
  );
  const main = (
    <>
      <MorePhotos photos={r.photos} />
      <section aria-labelledby="request-facts" className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 id="request-facts" className="text-xl font-bold text-ink">
          {x.moreTitle}
        </h2>
        <KeyValueList rows={moreRows(r)} />
      </section>
    </>
  );

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

      {composing ? (
        <OfferComposer requestId={r.id} defaults={r.defaults} tz={tz} aside={aside} main={main} />
      ) : (
        <DetailColumns
          aside={
            <>
              {aside}
              <section aria-labelledby="next-step" className="flex min-w-0 flex-col gap-4">
                <h2 id="next-step" className="text-xl font-bold text-ink">
                  {t.offerTitle}
                </h2>
                <NextStep r={r} />
              </section>
              {/* Торг (ТЗ п. 9) — сразу под откликом: здесь главное действие мастера («Принять N ₸» или своя цена). */}
              {r.myOffer && tz && <Negotiation offerId={r.myOffer.id} />}
            </>
          }
          main={main}
        />
      )}

      {/* Главное действие экрана — в торге или в шаге отклика; «Отправить» в чате — вторичная. */}
      {r.myOffer && <OfferChat offerId={r.myOffer.id} />}
    </Container>
  );
}

/** Коротко о заявке (макет: «Стиль — Современный», «Замер — Нужен»): то, по чему мастер решает, откликаться ли. */
function keyRows(r: IncomingRequest): KeyValueRow[] {
  const style = detailRows({ title: r.title, style: r.style, details: r.details }).find((row) => row.label === f.style);
  return [
    ...(style ? [{ label: style.label, value: style.value }] : []),
    ...(r.segment ? [{ label: f.segment, value: SEGMENT_NAMES[r.segment] }] : []),
    { label: f.city, value: r.city },
    ...(r.desiredDate ? [{ label: f.desiredDate, value: formatDate(r.desiredDate) }] : []),
    ...(r.publishedAt ? [{ label: x.published, value: formatRelative(r.publishedAt) }] : []),
  ];
}

/** Подробности: ответы заказчика (без типа и стиля — они выше), замеры площадки, адрес (до оферты — скрыт), пожелания. */
function moreRows(r: IncomingRequest): KeyValueRow[] {
  return [
    ...detailRows({ title: r.title, style: r.style, details: r.details }).filter((row) => row.label !== f.type && row.label !== f.style),
    ...(r.pre ? siteRows(r.pre) : []),
    { label: f.address, value: r.address ?? <span className="font-normal text-muted">{f.addressHidden}</span> },
    ...(r.location ? [{ label: f.location, value: f.locationValue(r.location.lat.toFixed(5), r.location.lng.toFixed(5)) }] : []),
    ...(r.wishes ? [{ label: f.wishes, value: r.wishes }] : []),
  ];
}

/** Главное фото помещения во всю ширину колонки; нет фото — иллюстрация вида мебели. */
function Cover({ title, photos }: { title: string; photos: IncomingRequest["photos"] }) {
  const first = photos[0];
  if (first) {
    // eslint-disable-next-line @next/next/no-img-element -- фото из хранилища
    return <img src={first.src} alt={x.photoAlt(1)} className="aspect-[4/3] w-full rounded-card border border-line bg-sunken object-cover" />;
  }
  const src = illustrationFor(title);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- иллюстрация из public/img
    <img src={src} alt={x.illustration} className="aspect-[16/9] w-full rounded-card border border-line bg-sunken object-cover" />
  ) : null;
}

/** Остальные фото помещения плиткой. */
function MorePhotos({ photos }: { photos: IncomingRequest["photos"] }) {
  const rest = photos.slice(1);
  if (rest.length === 0) return null;
  return (
    <ul aria-label={x.photosLabel} className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,7rem),1fr))] gap-3">
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
  const rows: KeyValueRow[] = [
    { label: tz ? t.myPrice : o.price, value: <Money amount={wholeKzt(offer.priceTiyn)} /> },
    { label: o.duration, value: formatDays(offer.durationDays) },
    { label: o.warranty, value: formatMonths(offer.warrantyMonths) },
    ...(tz ? [] : [{ label: o.measurement, value: termsText(offer.measurementTerms, offer.measurementFee) }]),
  ];
  return <KeyValueList rows={rows} />;
}

/** Одно состояние отклика мастера по его отклику и замеру (форма отклика — в OfferComposer). */
function NextStep({ r }: { r: IncomingRequest }) {
  const offer = r.myOffer;
  const tz = r.path === TZ_PATH;
  if (!offer) return <Alert tone="info">{ru.requests.status[r.status]}</Alert>;
  const m = offer.measurement;
  const card = (children: ReactNode) => (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
      <StatusBadge tone={m ? MEASUREMENT_TONE[m.status] : OFFER_TONE[offer.status]} className="self-start">
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
        {/* На пути ТЗ ссылку на сделку даёт и торг ниже — там она главная, здесь вторичная. */}
        <Alert
          tone="success"
          action={
            <ButtonLink href={offer.dealId ? `/deals/${offer.dealId}` : "/deals"} variant={tz ? "secondary" : "primary"}>
              {t.openOffer}
            </ButtonLink>
          }
        >
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
