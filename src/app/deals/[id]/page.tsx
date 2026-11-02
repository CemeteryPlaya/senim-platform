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
import { ButtonLink, Card, Container, DateText, Fact, formatMoney, Money, PageHeader, SimulatorBadge, StatusBadge } from "@/ui";
import { orNotFound } from "@/app/requests/_parts/guard";
import { ActionButton } from "../_parts/ActionButton";
import { DEAL_TONE, PAYMENT_TONE, STAGE_TONE } from "../_parts/labels";
import { cancelDealAction, retryOperationAction } from "./actions";
import { DisputePositionForm, OpenDisputeForm } from "./_parts/DealForms";
import { NextStepCard } from "./_parts/NextStepCard";

const t = ru.deal;
const p = ru.payments;

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

/** Сделка — одна длинная страница: что дальше, договор, этапы, оплата, акты, чат, спор, отзыв, история. */
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
      <PageHeader
        title={t.number(deal.number)}
        description={deal.title}
        back={{ href: "/deals" }}
        actions={<StatusBadge tone={DEAL_TONE[deal.status]}>{t.status[deal.status]}</StatusBadge>}
      />
      <div className="flex flex-col gap-6">
        <DealFlowSteps user={user} offerId={deal.offerId} />
        <NextStepCard deal={deal} />
        <Summary deal={deal} />
        <Section id="contract" title={t.sections.contract} note={t.contract.revealNote}>
          {contract && <DocumentPanel doc={contract} />}
        </Section>
        {deal.paymentMode !== "MANUAL" && <EscrowAccount deal={deal} />}
        <Stages deal={deal} />
        <Acts deal={deal} documents={documents} />
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

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-xl font-extrabold text-ink">
        {title}
      </h2>
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

function Summary({ deal }: { deal: DealView }) {
  return (
    <Card as="section">
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Fact label={t.total}>
          <Money amount={deal.totalAmount} />
        </Fact>
        <Fact label={ru.common.roles.EXECUTOR}>{deal.executorLabel}</Fact>
        {deal.executorAddress && <Fact label={ru.companies.identity.address}>{deal.executorAddress}</Fact>}
        <Fact label={t.createdAt}>
          <DateText value={deal.createdAt} format="date" />
        </Fact>
        <Fact label={t.paymentLabel}>{deal.paymentMode === "MANUAL" ? t.paymentModeManual : p.mode[deal.paymentMode]}</Fact>
      </dl>
    </Card>
  );
}

function EscrowAccount({ deal }: { deal: DealView }) {
  const e = deal.escrow;
  const a = p.account;
  return (
    <Card as="section" title={a.title} description={a.description}>
      <div className="flex flex-col gap-5">
        {deal.paymentMode === "ESCROW_SIMULATOR" && <SimulatorBadge />}
        {!e ? (
          <p className="text-base text-muted">{a.preparing}</p>
        ) : (
          <>
            <StatusBadge tone={e.status === "OPENED" ? "info" : "success"}>{a.status[e.status]}</StatusBadge>
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <Fact label={a.deposited}>
                <Money amount={e.deposited} />
              </Fact>
              <Fact label={a.released}>
                <Money amount={e.released} />
              </Fact>
              <Fact label={a.refunded}>
                <Money amount={e.refunded} />
              </Fact>
              <Fact label={a.balance}>
                <Money amount={e.deposited - e.released - e.refunded} />
              </Fact>
            </dl>
            <div>
              <h3 className="mb-3 text-lg font-bold text-ink">{a.requisites}</h3>
              <dl className="grid grid-cols-[minmax(0,1fr)] gap-3">
                <Fact label={a.bankName}>{e.requisites.bankName}</Fact>
                <Fact label={a.iban}>
                  <span className="font-mono break-all">{e.requisites.iban}</span>
                </Fact>
                <Fact label={a.bik}>{e.requisites.bik}</Fact>
                <Fact label={a.beneficiary}>{e.requisites.beneficiary}</Fact>
                <Fact label={a.purpose}>{e.requisites.paymentPurpose}</Fact>
              </dl>
            </div>
            <div>
              <h3 className="mb-3 text-lg font-bold text-ink">{a.operations}</h3>
              {deal.operations.length === 0 ? (
                <p className="text-base text-muted">{a.noOperations}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {deal.operations.map((op) => {
                    const kind = p.operation.kind[op.kind];
                    const amount = formatMoney(op.amount);
                    return (
                      <li key={op.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-base">
                        <span className="text-ink">{kind}</span>
                        <Money amount={op.amount} />
                        <StatusBadge tone={op.status === "SUCCEEDED" ? "success" : op.status === "FAILED" ? "danger" : "info"}>
                          {p.operation.status[op.status]}
                        </StatusBadge>
                        {op.retryKey && (
                          <ActionButton
                            action={retryOperationAction}
                            input={{ idempotencyKey: op.retryKey }}
                            variant="secondary"
                            ariaLabel={t.actions.retryOperationFor(kind, amount)}
                            confirm={{ title: t.actions.retryTitle, text: t.actions.retryText(kind, amount), yes: t.actions.retryYes, no: t.actions.retryNo, tone: "primary" }}
                          >
                            {t.actions.retryOperation}
                          </ActionButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {deal.paymentMode === "ESCROW_SIMULATOR" && (
              <ButtonLink href={`/simulator/bank/${e.accountId}`} variant="secondary" fullWidth>
                {t.actions.toBank}
              </ButtonLink>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Stages({ deal }: { deal: DealView }) {
  return (
    <Section id="stages" title={t.sections.stages}>
      <ol className="flex flex-col gap-4">
        {deal.stages.map((s) => (
          <Card as="li" key={s.id} titleAs="h3" title={`${t.stage.order(s.order)}. ${s.title}`} description={s.description || undefined}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={STAGE_TONE[s.status]}>{t.stageStatus[s.status]}</StatusBadge>
                {s.payment && <StatusBadge tone={PAYMENT_TONE[s.payment.status]}>{t.paymentStatus[s.payment.status]}</StatusBadge>}
                {s.acceptedAutomatically && <StatusBadge tone="info">{t.stage.acceptedAuto}</StatusBadge>}
              </div>
              <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Fact label={t.stage.amount}>{s.amount > 0 ? <Money amount={s.amount} /> : t.stage.noAmount}</Fact>
                {s.amount > 0 && <Fact label={t.stage.paymentWhen}>{t.paymentDue[s.paymentDue]}</Fact>}
                {s.submittedAt && (
                  <Fact label={t.stage.submittedAt}>
                    <DateText value={s.submittedAt} format="dateTime" />
                  </Fact>
                )}
              </dl>
              {s.status === "REWORK" && s.reworkNote && (
                <div className="rounded-control bg-warning-soft p-4">
                  <p className="text-base font-semibold text-ink">{t.stage.reworkNote}</p>
                  <p className="text-base text-ink">{s.reworkNote}</p>
                </div>
              )}
              {s.report && (
                <div>
                  <p className="text-base font-semibold text-ink">{t.stage.report}</p>
                  <p className="text-base whitespace-pre-line text-ink">{s.report}</p>
                </div>
              )}
              {s.photos.length > 0 && (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t.stage.photos}>
                  {s.photos.map((photo, i) => (
                    <li key={photo.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки хранилища, не статические ассеты */}
                      <img src={photo.src} alt={t.stage.photoAlt(s.title, i + 1)} className="aspect-square w-full rounded-control object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ))}
      </ol>
    </Section>
  );
}

function Acts({ deal, documents }: { deal: DealView; documents: SigningDocumentView[] }) {
  const acts = deal.stages.flatMap((s) => {
    const doc = documents.find((d) => d.kind === "STAGE_ACT" && d.stageId === s.id);
    return doc ? [{ stage: s, doc }] : [];
  });
  return (
    <Section id="acts" title={t.sections.acts} note={acts.length === 0 ? t.contract.noActs : undefined}>
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
