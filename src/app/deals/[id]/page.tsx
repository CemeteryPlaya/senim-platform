import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { DealPortfolioPanel } from "@/app/_components/deal-portfolio/DealPortfolioPanel";
import { DealFlowSteps } from "@/app/_components/pre-contract/DealFlowSteps";
import { orNotFound } from "@/app/requests/_parts/guard";
import { dealPartyOf, getDealView, type DealView } from "@/modules/deal-core";
import { listDealDocuments, type SigningDocumentView } from "@/modules/documents";
import { getCurrentUser, requireIntroduced, switchRoleHref, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { isAppError } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { Container, PageHeader, StatusBadge } from "@/ui";
import { DEAL_TONE } from "../_parts/labels";
import { otherPartyContacts } from "./_parts/contacts";
import { Estimate, MoneyBlock } from "./_parts/MoneyBlock";
import { NextStep } from "./_parts/NextStep";
import { OrderDetails } from "./_parts/OrderDetails";
import { CancelDeal, ContactsSection, DisputeSection, DocumentsSection, EventsSection, ProgressSection, ReadySection, Section } from "./_parts/Sections";

const t = ru.deal;

type Props = { params: Promise<{ id: string }> };

/** Один запрос сделки на заголовок вкладки и страницу (getCurrentUser тоже кэширован — тот же объект). */
const loadDeal = cache((user: CurrentUser, id: string) => getDealView(user, id));

/** Заголовок вкладки — «Сделка №N»; без доступа — общий «Сделки» (саму ошибку покажет страница). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: t.listTitle };
  try {
    return { title: t.number((await loadDeal(user, id)).number) };
  } catch (e) {
    if (isAppError(e)) return { title: t.listTitle };
    throw e;
  }
}

/**
 * Сделка недоступна в активной роли, но человек — её сторона в другой своей роли (ADR-004):
 * на переключение роли с возвратом сюда. Иначе — 404 через orNotFound.
 */
async function loadOrSwitchRole(user: CurrentUser, id: string): Promise<DealView> {
  const party = user.roles.length > 1 ? await dealPartyOf(user, id) : null;
  if (party && party !== user.role && user.roles.includes(party)) redirect(switchRoleHref(party, `/deals/${id}`));
  return orNotFound(loadDeal(user, id));
}

/** Панель подписи нужна, только когда смотрящему есть что подписать (оферта или акт). */
const needsSigning = (deal: DealView) => deal.next.mine && (deal.next.action === "signContract" || deal.next.action === "signAct");

/**
 * Карточка сделки (ТЗ п. 4.1, 9) — общая для покупателя, мастера и оператора. Первый блок — деньги из журнала
 * (тап — «История денег»), до оплаты — смета; затем «Что дальше» с единственным главным действием (deal-core.nextStep);
 * «Подробнее о заказе» свёрнуто. Ниже — сдача, ход работ, документы, контакты, чат, спор, история событий.
 */
export default async function DealPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/deals/${id}`)}`);
  requireIntroduced(user, `/deals/${id}`);
  const deal = await loadOrSwitchRole(user, id);
  const [signable, contacts] = await Promise.all([
    needsSigning(deal) ? listDealDocuments(user, deal.id) : Promise.resolve<SigningDocumentView[]>([]),
    otherPartyContacts(deal),
  ]);
  const openDispute = deal.dispute?.status === "OPEN";

  return (
    <Container size="form">
      <PageHeader
        title={t.number(deal.number)}
        back={{ href: "/deals" }}
        description={
          <span className="flex flex-wrap gap-2">
            <StatusBadge tone={DEAL_TONE[deal.status]}>{t.status[deal.status]}</StatusBadge>
            {openDispute && <StatusBadge tone="warning">{t.disputeOpenBadge}</StatusBadge>}
          </span>
        }
      />
      <div className="flex flex-col gap-6 pb-10">
        {deal.viewer === "OPERATOR" && <p className="text-base text-muted">{t.view.operatorWatch}</p>}
        <MoneyBlock deal={deal} />
        <Estimate deal={deal} />
        <NextStep deal={deal} />
        {/* Сценарии до договора (ADR-005) — под флагом preContractFlows, только пока оферта не исполняется. */}
        {isEnabled("preContractFlows") && deal.status === "CREATED" && <DealFlowSteps user={user} offerId={deal.offerId} />}
        <OrderDetails deal={deal} now={new Date()} />
        <ReadySection deal={deal} />
        <ProgressSection deal={deal} />
        <DocumentsSection deal={deal} signable={signable} />
        <ContactsSection contacts={contacts} />
        <div className="border-t border-line pt-6">
          <OfferChat offerId={deal.offerId} />
        </div>
        <DisputeSection deal={deal} />
        {deal.review && (
          <Section id="review" title={t.sections.review}>
            <p className="text-lg font-semibold text-ink">{t.review.stars(deal.review.rating)}</p>
            {deal.review.text && <p className="text-base text-ink">{deal.review.text}</p>}
          </Section>
        )}
        <DealPortfolioPanel user={user} dealId={deal.id} />
        <EventsSection deal={deal} />
        <CancelDeal deal={deal} />
      </div>
    </Container>
  );
}
