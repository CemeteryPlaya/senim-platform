import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { DealPortfolioPanel } from "@/app/_components/deal-portfolio/DealPortfolioPanel";
import { SigningPanel } from "@/app/_components/signing";
import { dealPartyOf, getDealView, type DealView } from "@/modules/deal-core";
import { DealFlowSteps } from "@/app/_components/pre-contract/DealFlowSteps";
import { listDealDocuments, type SigningDocumentView } from "@/modules/documents";
import { getCurrentUser, requireIntroduced, switchRoleHref, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { isAppError } from "@/platform/errors";
import { Card, Container, DateText, Fact, Money, PageHeader, StatusBadge } from "@/ui";
import { orNotFound } from "@/app/requests/_parts/guard";
import { ActionButton } from "../_parts/ActionButton";
import { cancelDealAction } from "./actions";
import { DisputePositionForm, OpenDisputeForm } from "./_parts/DealForms";
import { NextStepCard } from "./_parts/NextStepCard";
import { OrderDetails } from "./_parts/OrderDetails";
import { OrderSummary } from "./_parts/OrderSummary";
import { Payment } from "./_parts/Payment";
import { StageTimeline } from "./_parts/StageTimeline";

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
 * на переключение роли с возвратом сюда. Иначе — как раньше (404 через orNotFound).
 */
async function loadOrSwitchRole(user: CurrentUser, id: string): Promise<DealView> {
  const party = user.roles.length > 1 ? await dealPartyOf(user, id) : null;
  if (party && party !== user.role && user.roles.includes(party)) redirect(switchRoleHref(party, `/deals/${id}`));
  return orNotFound(loadDeal(user, id));
}

/**
 * «Мой заказ» (макет 10) — одна длинная страница, общая для заказчика, исполнителя и оператора: фото и плашка
 * статуса, ключевые данные и шкала этапов, «Что дальше» с единственным главным действием, этапы с фотоотчётами,
 * детали, документы, оплата, чат, спор, отзыв, портфолио, история. Действия по роли решает deal-core (next-step).
 */
export default async function DealPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/deals/${id}`)}`);
  requireIntroduced(user, `/deals/${id}`);
  const deal = await loadOrSwitchRole(user, id);
  const documents = await listDealDocuments(user, deal.id);
  const isParty = deal.viewer === "CLIENT" || deal.viewer === "EXECUTOR";
  const contract = documents.find((d) => d.kind === "CONTRACT");

  return (
    <Container size="form">
      <PageHeader title={t.number(deal.number)} back={{ href: "/deals" }} />
      <div className="flex flex-col gap-6 pb-10">
        <DealFlowSteps user={user} offerId={deal.offerId} />
        <OrderSummary deal={deal} now={new Date()} />
        <NextStepCard deal={deal} />
        <StageTimeline deal={deal} />
        <OrderDetails deal={deal} />
        <Section id="documents" title={t.sections.documents} note={t.contract.revealNote}>
          {contract && <DocumentPanel doc={contract} />}
          <Acts deal={deal} documents={documents} />
        </Section>
        <Payment deal={deal} />
        <OfferChat offerId={deal.offerId} />
        <Dispute deal={deal} isParty={isParty} />
        {deal.review && (
          <Card as="section" title={t.sections.review}>
            <p className="text-lg font-semibold text-ink">{t.review.stars(deal.review.rating)}</p>
            {deal.review.text && <p className="mt-2 text-base text-ink">{deal.review.text}</p>}
          </Card>
        )}
        <DealPortfolioPanel user={user} dealId={deal.id} />
        <History deal={deal} />
        {isParty && (deal.status === "AWAITING_SIGNATURES" || deal.status === "AWAITING_DEPOSIT") && (
          <ActionButton
            action={cancelDealAction}
            input={{ dealId: deal.id }}
            variant="ghost"
            confirm={{ title: t.forms.cancelTitle, text: t.forms.cancelText, yes: t.actions.confirmCancel, no: ru.common.actions.dontCancel, tone: "danger" }}
          >
            {t.actions.cancelDeal}
          </ActionButton>
        )}
      </div>
    </Container>
  );
}

function Section({ id, title, note, level = "h2", children }: { id: string; title: string; note?: string; level?: "h2" | "h3"; children: ReactNode }) {
  const Heading = level;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <Heading id={`${id}-title`} className={level === "h2" ? "text-xl font-extrabold text-ink" : "text-lg font-bold text-ink"}>
        {title}
      </Heading>
      {note && <p className="text-base text-muted">{note}</p>}
      {children}
    </section>
  );
}

/** Панель документа (documents-engineer): PDF, хэш, подписи сторон и подпись ЭЦП. Якорь — для «Перейти к подписи». */
function DocumentPanel({ doc }: { doc: SigningDocumentView }) {
  return (
    <div id={`doc-${doc.id}`} className="scroll-mt-6">
      <SigningPanel document={doc} titleAs="h3" />
    </div>
  );
}

function Acts({ deal, documents }: { deal: DealView; documents: SigningDocumentView[] }) {
  const acts = deal.stages.flatMap((s) => {
    const doc = documents.find((d) => d.kind === "STAGE_ACT" && d.stageId === s.id);
    return doc ? [{ stage: s, doc }] : [];
  });
  return (
    <Section id="acts" level="h3" title={t.sections.acts} note={acts.length === 0 ? t.contract.noActs : undefined}>
      {acts.map(({ stage, doc }) => (
        <div key={doc.id} className="flex flex-col gap-2">
          <p className="text-base font-semibold text-muted">{t.contract.actFor(stage.order, stage.title)}</p>
          <DocumentPanel doc={doc} />
        </div>
      ))}
    </Section>
  );
}

function Dispute({ deal, isParty }: { deal: DealView; isParty: boolean }) {
  const d = deal.dispute;
  if (!d) {
    if (!isParty || deal.status !== "IN_PROGRESS") return null;
    return (
      <details className="rounded-card border border-line bg-surface p-5">
        <summary className="min-h-control-sm cursor-pointer text-lg font-semibold text-ink">{t.actions.openDispute}</summary>
        <div className="pt-4">
          <OpenDisputeForm dealId={deal.id} />
        </div>
      </details>
    );
  }
  const myPosition = deal.viewer === "CLIENT" ? d.clientPosition : deal.viewer === "EXECUTOR" ? d.executorPosition : "";
  return (
    <Card as="section" title={t.sections.dispute}>
      <div className="flex flex-col gap-4">
        <StatusBadge tone={d.status === "OPEN" ? "danger" : "neutral"}>{d.status === "OPEN" ? t.dispute.open : t.dispute.resolved}</StatusBadge>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <Fact label={t.forms.disputeReason}>{t.dispute.reason[d.reason]}</Fact>
          <Fact label={t.dispute.openedAt}>
            <DateText value={d.createdAt} format="dateTime" />
          </Fact>
          <Fact label={t.dispute.clientPosition}>{d.clientPosition ?? t.dispute.noPosition}</Fact>
          <Fact label={t.dispute.executorPosition}>{d.executorPosition ?? t.dispute.noPosition}</Fact>
          {d.decision && <Fact label={t.dispute.resolved}>{t.dispute.decision[d.decision]}</Fact>}
          {d.decisionAmount !== null && (
            <Fact label={t.dispute.decisionAmount}>
              <Money amount={d.decisionAmount} />
            </Fact>
          )}
          {d.rationale && <Fact label={t.dispute.rationale}>{d.rationale}</Fact>}
        </dl>
        {isParty && d.status === "OPEN" && !myPosition && <DisputePositionForm disputeId={d.id} />}
      </div>
    </Card>
  );
}

function History({ deal }: { deal: DealView }) {
  const h = t.history;
  return (
    <Card as="section" title={t.sections.history}>
      {deal.history.length === 0 ? (
        <p className="text-base text-muted">{h.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {deal.history.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
              <span className="text-base text-ink">{h.action[e.action] ?? e.action}</span>
              <span className="text-base text-muted">
                {h.actor[e.actorRole as keyof typeof h.actor] ?? e.actorRole} · <DateText value={e.createdAt} format="dateTime" />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
