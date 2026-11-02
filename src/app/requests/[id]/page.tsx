import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { cache } from "react";
import { getCurrentUser, hasClientIdentity, type CurrentUser } from "@/modules/identity";
import { activeRailMode, type RailMode } from "@/modules/payments";
import { getClientRequest, listOffers, OFFER_SORTS, type ClientRequest, type OfferSort } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Container, EmptyState, Money, PageHeader, StatusBadge, cn, formatDateTime, formatMoney } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { cancelRequestAction, clientNoDealAction } from "../actions";
import { ActionButton } from "../_parts/ActionButton";
import { orNotFound, pageUser } from "../_parts/guard";
import { REQUEST_TONE } from "../_parts/labels";
import { detailRows, FactList } from "../_parts/RequestFacts";
import { AgreeForm } from "./AgreeForm";
import { OfferCard } from "./OfferCard";
import { NoAccess } from "@/app/_components/NoAccess";

const t = ru.requests.request;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string; sent?: string }> };

/** Один запрос заявки на заголовок вкладки и страницу. */
const loadRequest = cache((user: CurrentUser, id: string) => getClientRequest(user, id));

/** Заголовок вкладки — «Заявка №N: тип»; без доступа — общий «Заявка» (саму ошибку покажет страница). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user?.role !== "CLIENT") return { title: ru.requests.untitled };
  try {
    const request = await loadRequest(user, id);
    return { title: ru.requests.requestTitle(request.number, request.title) };
  } catch (e) {
    if (isAppError(e)) return { title: ru.requests.untitled };
    throw e;
  }
}

const CANCELLABLE = new Set(["OPEN", "OFFER_CHOSEN", "MEASURING"]);

/** Заявка заказчика: состояние (выбор, замер, договор) и отклики с сортировкой (макет 783). */
export default async function RequestPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await pageUser("CLIENT", `/requests/${id}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccess} />;
  }
  const request = await orNotFound(loadRequest(user, id));
  if (request.status === "DRAFT") redirect(`/requests/new?draft=${id}`);
  const sort: OfferSort = OFFER_SORTS.find((s) => s === sp.sort) ?? "price";
  const offers = await listOffers(user, { requestId: id, sort });
  const needsIdentity = request.status === "MEASURING" && !(await hasClientIdentity(user.id));
  const rail = await activeRailMode();

  return (
    <Container className="flex flex-col gap-8 pb-10">
      <PageHeader
        back={{ href: "/requests", label: ru.requests.my.title }}
        title={ru.requests.requestTitle(request.number, request.title)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={REQUEST_TONE[request.status]}>{ru.requests.status[request.status]}</StatusBadge>
            {request.segment && <StatusBadge>{SEGMENT_NAMES[request.segment]}</StatusBadge>}
            {request.mode === "DIRECT" && <StatusBadge tone="accent">{ru.requests.mode.DIRECT}</StatusBadge>}
          </span>
        }
      />

      {sp.sent === "1" && request.status === "OPEN" && (
        <Alert tone="success" live="polite" title={t.sentTitle}>
          {t.sentText}
        </Alert>
      )}
      <StatusPanel request={request} needsIdentity={needsIdentity} rail={rail} />

      <section aria-labelledby="offers-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="offers-title" className="text-2xl font-bold text-ink">
            {t.offersTitle} <span className="text-muted">({offers.length})</span>
          </h2>
          {offers.length > 1 && <SortLinks requestId={id} current={sort} />}
        </div>
        {offers.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t.offersEmptyTitle} description={t.offersEmptyText} titleAs="h3" />
        ) : (
          <ul className="flex flex-col gap-4">
            {offers.map((offer) => (
              <li key={offer.id}>
                <OfferCard offer={offer} requestId={id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="details-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <h2 id="details-title" className="text-xl font-bold text-ink">
          {t.detailsTitle}
        </h2>
        <FactList
          rows={[
            ...detailRows({ title: request.title, style: request.style, details: request.details }),
            { label: ru.requests.facts.city, value: request.city },
            ...(request.address ? [{ label: ru.requests.facts.address, value: request.address }] : []),
            ...(request.wishes ? [{ label: ru.requests.facts.wishes, value: request.wishes }] : []),
          ]}
        />
      </section>

      {CANCELLABLE.has(request.status) && (
        <div className="self-start">
          <ActionButton
            action={cancelRequestAction}
            input={{ requestId: id }}
            variant="ghost"
            confirm={{ title: t.cancelConfirmTitle, text: t.cancelConfirmText, yes: t.cancelConfirm, no: ru.common.actions.dontCancel, tone: "danger" }}
          >
            {t.cancel}
          </ActionButton>
        </div>
      )}
    </Container>
  );
}

function SortLinks({ requestId, current }: { requestId: string; current: OfferSort }) {
  return (
    <nav aria-label={t.sortLabel}>
      <ul className="flex flex-wrap gap-2">
        {OFFER_SORTS.map((s) => (
          <li key={s}>
            <Link
              href={`/requests/${requestId}?sort=${s}`}
              aria-current={s === current ? "true" : undefined}
              scroll={false}
              className={cn(
                "inline-flex min-h-control-sm items-center rounded-full border px-4 text-base font-semibold no-underline",
                s === current ? "border-primary bg-accent-soft text-primary" : "border-line-strong bg-surface text-ink hover:bg-sunken",
              )}
            >
              {t.sort[s]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Что происходит с заявкой сейчас и одно главное действие для этого шага. */
function StatusPanel({ request, needsIdentity, rail }: { request: ClientRequest; needsIdentity: boolean; rail: RailMode }) {
  const { chosen, measurement: m } = request;
  const fee = chosen?.measurementTerms === "FEE_IF_NO_DEAL" && chosen.measurementFee ? chosen.measurementFee : null;
  const noDeal = m && (
    <ActionButton
      action={clientNoDealAction}
      input={{ measurementId: m.id, result: "" }}
      variant="secondary"
      confirm={{
        title: t.noDealConfirmTitle,
        text: (
          <>
            {t.noDealConfirmText} {fee !== null && t.noDealFee(formatMoney(fee))}
          </>
        ),
        yes: t.noDeal,
        no: ru.common.actions.dontCancel,
        tone: "danger",
      }}
    >
      {t.noDeal}
    </ActionButton>
  );

  switch (request.status) {
    case "OPEN":
      return (
        <Alert tone="accent" title={t.waitingTitle}>
          {t.waitingText}
        </Alert>
      );
    case "OFFER_CHOSEN":
      return chosen ? (
        <Alert
          tone="accent"
          title={t.chosenTitle(chosen.executorLabelGen)}
          action={
            <ButtonLink href={`/requests/${request.id}/offers/${chosen.id}#chat`} variant="secondary">
              {t.openChosen}
            </ButtonLink>
          }
        >
          {t.chosenText}
        </Alert>
      ) : null;
    case "MEASURING":
      if (m?.status === "DONE" && m.finalPrice !== null) {
        return (
          <section aria-labelledby="measured" className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
            <h2 id="measured" className="text-xl font-bold text-ink">
              {t.measuredTitle}
            </h2>
            <p className="flex flex-col">
              <span className="text-base text-muted">{t.finalPrice}</span>
              <Money amount={m.finalPrice} className="text-3xl font-extrabold text-ink" />
            </p>
            {m.result && (
              <p className="text-base text-ink">
                <span className="text-muted">{t.measurementResult}: </span>
                {m.result}
              </p>
            )}
            <AgreeForm requestId={request.id} needsIdentity={needsIdentity} rail={rail} />
            <div className="self-start">{noDeal}</div>
          </section>
        );
      }
      return m ? (
        <Alert tone="info" title={t.scheduledTitle} action={noDeal}>
          {t.scheduledText(formatDateTime(m.scheduledAt))}
        </Alert>
      ) : null;
    case "CONTRACTING":
    case "CLOSED":
      return (
        <Alert
          tone="success"
          title={request.status === "CONTRACTING" ? t.contractingTitle : undefined}
          action={request.deal && <ButtonLink href={`/deals/${request.deal.id}`}>{t.openDeal}</ButtonLink>}
        >
          {request.status === "CONTRACTING" ? t.contractingText : t.closedText}
        </Alert>
      );
    case "CANCELLED":
      return <Alert tone="info">{t.cancelledText}</Alert>;
    case "DRAFT":
      return null;
  }
}
