import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { DealContacts } from "@/app/_components/chat/DealContacts";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { DealPortfolioPanel } from "@/app/_components/deal-portfolio/DealPortfolioPanel";
import { DealFlowSteps } from "@/app/_components/pre-contract/DealFlowSteps";
import { DealDocuments, SigningPanel, signingAnchorId } from "@/app/_components/signing";
import { orNotFound } from "@/app/requests/_parts/guard";
import { dealPartyOf, getDealView, type DealView } from "@/modules/deal-core";
import { LINK_TTL_HOURS, listDealDocuments } from "@/modules/documents";
import { getCurrentUser, needsSecondFactor, requireIntroduced, switchRoleHref, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { isAppError } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { Container, DealProgress, DetailColumns, PageHeader, SignedBadge, StatusBadge } from "@/ui";
import { DEAL_TONE } from "../_parts/labels";
import { Estimate, MoneyBlock } from "./_parts/MoneyBlock";
import { NextStep, stepAction } from "./_parts/NextStep";
import { OrderDetails } from "./_parts/OrderDetails";
import { CancelDeal, DisputeSection, EventsSection, ProgressSection, ReadySection, Section, SECTION_CARD } from "./_parts/Sections";

const t = ru.deal;

type Props = { params: Promise<{ id: string }> };

/** Один запрос сделки на заголовок вкладки и страницу (getCurrentUser тоже кэширован — тот же объект). */
const loadDeal = cache((user: CurrentUser, id: string) => getDealView(user, id));

/** Заголовок вкладки — «Сделка №N»; без доступа — общий «Сделки» (саму ошибку покажет страница). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  // Оператор без второй ступени не видит и номера сделки: страница уведёт его на /operator/mfa.
  if (!user || needsSecondFactor(user)) return { title: t.listTitle };
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

/**
 * Карточка сделки (ТЗ п. 4.1, 9; макет b-plus-a, экран 3) — общая для покупателя, мастера и оператора. Сверху — ход
 * сделки (5 шагов; отмена и возврат — плашка), затем деньги из журнала (тап — «История денег»; до оплаты — смета),
 * подпись оферты ЭЦП, текущее событие «Что дальше» и сдача работы; ниже — ход работ, документы, контакты, чат, спор,
 * история событий. Единственное действие шага — в StickyAction (на десктопе — правая колонка под деньгами).
 */
export default async function DealPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/deals/${id}`)}`);
  requireIntroduced(user, `/deals/${id}`);
  const deal = await loadOrSwitchRole(user, id);
  const docs = await listDealDocuments(user, deal.id);
  const openDispute = deal.dispute?.status === "OPEN";

  return (
    <Container className="pb-10">
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
      <DetailColumns
        lead={<DealProgress status={deal.status} hasOpenDispute={openDispute} />}
        aside={
          <>
            <MoneyBlock deal={deal} />
            <Estimate deal={deal} />
          </>
        }
        main={
          <>
            {deal.viewer === "OPERATOR" && <p className="text-base text-muted">{t.view.operatorWatch}</p>}
            {deal.dates.signedAt && deal.contract && <SignedBadge signedAt={deal.dates.signedAt} documentNumber={deal.contract.number} />}
            <NextStep deal={deal} />
            <ReadySection deal={deal} />
            {/* Сценарии до договора (ADR-005) — под флагом preContractFlows, только пока оферта не исполняется. */}
            {isEnabled("preContractFlows") && deal.status === "CREATED" && <DealFlowSteps user={user} offerId={deal.offerId} />}
            <OrderDetails deal={deal} now={new Date()} />
            <ProgressSection deal={deal} />
            {/* Документы (ТЗ п. 7): список с «Открыть / Скачать / Поделиться» и панели подписи — якорь #doc-<id> для «Подписать». */}
            <div className="flex flex-col gap-6">
              <div className={SECTION_CARD}>
                <DealDocuments documents={docs} linkTtlHours={LINK_TTL_HOURS} signLinks />
              </div>
              {docs
                .filter((d) => d.signable)
                .map((d) => (
                  <div id={signingAnchorId(d.id)} key={d.id} className="scroll-mt-6">
                    <SigningPanel document={d} titleAs="h3" signerName={user.fullName ?? undefined} actionVariant="secondary" />
                  </div>
                ))}
            </div>
            <DealContacts dealId={deal.id} className={SECTION_CARD} />
            {/* Одна заливная кнопка на экран — действие шага в StickyAction; кнопки подписи и чата вторичные.
                Контакты — один раз, в карточке DealContacts выше; под чатом их не повторяем. */}
            <OfferChat offerId={deal.offerId} showContacts={false} />
            <DisputeSection deal={deal} />
            {deal.review && (
              <Section id="review" title={t.sections.review}>
                <p className="text-lg font-semibold text-ink">{t.review.stars(deal.review.rating)}</p>
                {deal.review.text && <p className="text-base text-ink">{deal.review.text}</p>}
              </Section>
            )}
            {isEnabled("dealPortfolio") && <DealPortfolioPanel user={user} dealId={deal.id} />}
            <EventsSection deal={deal} />
            <CancelDeal deal={deal} />
          </>
        }
        action={stepAction(deal)}
      />
    </Container>
  );
}
