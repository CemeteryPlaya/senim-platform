import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { cache, type ReactNode } from "react";
import { getCurrentUser, hasClientIdentity, type CurrentUser } from "@/modules/identity";
import { activeRailMode, type RailMode } from "@/modules/payments";
import { getClientRequest, listOffers, OFFER_SORTS, type ClientRequest, type OfferListItem, type OfferSort } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Container, EmptyState, FilterChips, Money, PageHeader, SectionTitle, StatusBadge, formatDateTime, formatMoney } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { cancelRequestAction, clientNoDealAction } from "../actions";
import { ActionButton } from "../_parts/ActionButton";
import { orNotFound, pageUser } from "../_parts/guard";
import { REQUEST_TONE } from "../_parts/labels";
import { detailRows, FactList } from "../_parts/RequestFacts";
import { AgreeForm } from "./AgreeForm";
import { ClientProject, ContractSummary, ContractTerms, DepositClient, SiteWait } from "./PreContractClient";
import { FlowSteps } from "@/app/_components/pre-contract/FlowSteps";
import { SizesBasis, siteRows } from "@/app/_components/pre-contract/SizesBasis";
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

/**
 * Заявка заказчика (макеты 7–9): шкала этапов сценария, мятная плашка «что сейчас» с одним главным действием,
 * отклики с сортировкой чипами и сравнением, справа (на телефоне — ниже) — что в заявке.
 */
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
  const needsIdentity = (request.status === "MEASURING" || request.status === "OFFER_CHOSEN") && !(await hasClientIdentity(user.id));
  const rail = await activeRailMode();

  return (
    <Container className="flex flex-col gap-6 pb-10">
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
        className="pb-0"
      />

      <FlowSteps flow={request.pre.flow} steps={request.pre.steps} current={request.pre.current} />
      {sp.sent === "1" && (request.status === "OPEN" || request.status === "PLATFORM_MEASURING") && (
        <Alert tone="success" live="polite" title={t.sentTitle}>
          {t.sentText}
        </Alert>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <StatusPanel request={request} needsIdentity={needsIdentity} rail={rail} />
          <Offers requestId={id} pre={request.pre} offers={offers} sort={sort} />
        </div>

        <aside aria-labelledby="details-title" className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-4 border-t border-line pt-6 lg:border-t-0 lg:pt-0">
            <h2 id="details-title" className="text-xl font-bold text-ink">
              {t.detailsTitle}
            </h2>
            <FactList
              rows={[
                ...detailRows({ title: request.title, style: request.style, details: request.details }),
                ...siteRows(request.pre),
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
        </aside>
      </div>
    </Container>
  );
}

/** Отклики: чипы сортировки (сравнение — ими же: дешевле, быстрее, рейтинг) и карточки. */
function Offers({ requestId, pre, offers, sort }: { requestId: string; pre: ClientRequest["pre"]; offers: OfferListItem[]; sort: OfferSort }) {
  return (
    <section aria-labelledby="offers-title" className="flex flex-col gap-4">
      <SectionTitle
        id="offers-title"
        title={
          <>
            {t.offersTitle} <span className="text-muted">({offers.length})</span>
          </>
        }
      />
      <SizesBasis pre={pre} />
      {offers.length > 1 && (
        <FilterChips
          label={t.sortLabel}
          current={sort}
          chips={OFFER_SORTS.map((s) => ({ key: s, label: t.sort[s], href: `/requests/${requestId}?sort=${s}` }))}
        />
      )}
      {offers.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t.offersEmptyTitle} description={t.offersEmptyText} titleAs="h3" />
      ) : (
        <ul className="flex flex-col gap-4">
          {offers.map((offer) => (
            <li key={offer.id}>
              <OfferCard offer={offer} requestId={requestId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type PanelProps = { request: ClientRequest; needsIdentity: boolean; rail: RailMode };

/** «Сделка не состоится» после выезда исполнителя: отклик отклоняется, заявка снова открыта. */
function NoDealButton({ request }: { request: ClientRequest }) {
  const { chosen, measurement: m } = request;
  if (!m) return null;
  const fee = chosen?.measurementTerms === "FEE_IF_NO_DEAL" && chosen.measurementFee ? chosen.measurementFee : null;
  return (
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
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 rounded-card border border-line p-5 sm:p-6">
      <h2 id={id} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Согласие на договор без выезда исполнителя (макет 9, экран 1): итоговая стоимость, адрес, порядок оплаты. */
function AgreePanel({ request, needsIdentity, rail }: PanelProps) {
  const { pre } = request;
  return (
    <Panel id="agree" title={ru.requests.pre.steps.contract}>
      <ContractTerms pre={pre} />
      <ContractSummary pre={pre} price={pre.tolerance?.price ?? request.chosen?.price ?? 0} priceLabel={ru.requests.offer.price} address={request.address} />
      <AgreeForm requestId={request.id} needsIdentity={needsIdentity} rail={rail} />
    </Panel>
  );
}

/** Отклик выбран: следующий шаг по сценарию — залог, замер исполнителем, проект или договор. */
function ChosenPanel(props: PanelProps) {
  const { request } = props;
  const { chosen, pre } = request;
  if (!chosen) return null;
  switch (pre.current) {
    case "deposit":
      return <DepositClient pre={pre} offerId={chosen.id} />;
    case "project":
      return <ClientProject pre={pre} />;
    case "contract":
      return <AgreePanel {...props} />;
    default:
      return (
        <Alert
          tone="accent"
          title={t.chosenTitle(chosen.executorLabelGen)}
          action={<ButtonLink href={`/requests/${request.id}/offers/${chosen.id}#chat`}>{t.openChosen}</ButtonLink>}
        >
          {pre.deposit?.status === "CONFIRMED" ? ru.requests.pre.deposit.confirmedClient : t.chosenText}
        </Alert>
      );
  }
}

/** Замер исполнителем: назначен → выполнен → проект → согласие на договор (макеты 7–9). */
function MeasuringPanel(props: PanelProps) {
  const { request } = props;
  const { measurement: m, pre } = request;
  if (!m) return null;
  if (m.status !== "DONE" || m.finalPrice === null) {
    return (
      <Alert tone="accent" title={t.scheduledTitle} action={<NoDealButton request={request} />}>
        {t.scheduledText(formatDateTime(m.scheduledAt))}
      </Alert>
    );
  }
  const ready = pre.current === "contract";
  return (
    <>
      <Panel id="measured" title={t.measuredTitle}>
        {ready ? (
          <ContractSummary pre={pre} price={m.finalPrice} priceLabel={t.finalPrice} address={request.address} />
        ) : (
          <p className="flex flex-col">
            <span className="text-base text-muted">{t.finalPrice}</span>
            <Money amount={m.finalPrice} className="text-3xl font-extrabold text-ink" />
          </p>
        )}
        {m.result && (
          <p className="border-l-2 border-line pl-4 text-base text-ink">
            <span className="text-muted">{t.measurementResult}: </span>
            {m.result}
          </p>
        )}
        {ready && <AgreeForm requestId={request.id} needsIdentity={props.needsIdentity} rail={props.rail} />}
        <div className="self-start">
          <NoDealButton request={request} />
        </div>
      </Panel>
      {!ready && <ClientProject pre={pre} />}
    </>
  );
}

/** Что происходит с заявкой сейчас и одно главное действие для этого шага. */
function StatusPanel(props: PanelProps) {
  const { request } = props;
  switch (request.status) {
    case "PLATFORM_MEASURING":
      return <SiteWait pre={request.pre} />;
    case "OPEN":
      // Ждём откликов: это видно по статусу у заголовка и по списку ниже — плашка не нужна.
      return null;
    case "OFFER_CHOSEN":
      return <ChosenPanel {...props} />;
    case "MEASURING":
      return <MeasuringPanel {...props} />;
    case "CONTRACTING":
    case "CLOSED":
      return (
        <>
          <Alert
            tone="success"
            title={request.status === "CONTRACTING" ? t.contractingTitle : undefined}
            action={request.deal && <ButtonLink href={`/deals/${request.deal.id}`}>{t.openDeal}</ButtonLink>}
          >
            {request.status === "CONTRACTING" ? t.contractingText : t.closedText}
          </Alert>
          {/* «Договор до замера»: проект утверждается уже по договору. */}
          {!request.pre.rules.projectBeforeContract && <ClientProject pre={request.pre} />}
        </>
      );
    case "CANCELLED":
      return <Alert tone="info">{t.cancelledText}</Alert>;
    case "DRAFT":
      return null;
  }
}
