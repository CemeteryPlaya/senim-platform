import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { getBankDemo, isDemoMode, type BankDemo, type ScenarioStep } from "@/modules/operator";
import { Alert, Button, ButtonLink, Card, Container, DateText, EmptyState, Money, PageHeader, Select, SimulatorBadge, StatusBadge } from "@/ui";
import { AuditList } from "../operator/_components/AuditList";

const t = ru.bankDemo;
const o = ru.operator;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

const dealParam = z.coerce.number().int().positive().optional().catch(undefined);

function Step({ step, index }: { step: ScenarioStep; index: number }) {
  const s = t.steps[step.key];
  const ref = step.number === undefined ? null : ["offers", "measurement"].includes(step.key) ? t.request(step.number) : t.deal(step.number);
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
      <p className="text-sm text-muted">{t.step(index + 1)}</p>
      <h3 className="text-lg font-bold text-ink">
        {s.title}
        {ref && <span className="font-normal text-ink-soft">, {ref}</span>}
      </h3>
      <p className="text-ink-soft">{s.text}</p>
      {step.persona && (
        <p className="text-base text-ink">
          {t.persona} ({t.roles[step.persona.role]}): {t.personaValue(step.persona.name, step.persona.phone)}
        </p>
      )}
      {step.href ? (
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={step.href} variant="secondary">
            {t.open}
          </ButtonLink>
          {step.extraHref && (
            <ButtonLink href={step.extraHref} variant="soft">
              {t.openSimulator}
            </ButtonLink>
          )}
        </div>
      ) : step.needsEscrow ? (
        <Alert tone="info" action={<ButtonLink href="/operator/demo" variant="secondary">{t.enableEscrow}</ButtonLink>}>
          {t.needsEscrow}
        </Alert>
      ) : (
        <p className="text-muted">{t.missing}</p>
      )}
    </li>
  );
}

function Documents({ documents }: { documents: NonNullable<BankDemo["selected"]>["documents"] }) {
  if (documents.length === 0) return <p className="text-ink-soft">{t.documentsEmpty}</p>;
  return (
    <ul className="flex flex-col">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">
              {t.docKinds[d.kind]} {d.number}
            </span>
            <span className="text-sm text-muted">{t.version(d.version)}</span>
            <StatusBadge tone={d.status === "SIGNED" ? "success" : "neutral"}>{t.docStatus[d.status]}</StatusBadge>
          </p>
          <p className="text-sm break-all text-ink-soft">
            {t.hash}: {d.sha256}
          </p>
          {d.signatures.length === 0 ? (
            <p className="text-sm text-muted">{t.noSignatures}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {d.signatures.map((s) => (
                <li key={s.party} className="flex flex-col">
                  <span className="text-ink">
                    {t.parties[s.party]}, {t.methods[s.method]}, <DateText value={s.signedAt} format="dateTime" />
                  </span>
                  <span className="break-words text-ink-soft">{s.certSubject}</span>
                  <span className="text-ink-soft">
                    {t.signedHash}: {s.signedSha256 === d.sha256 ? t.hashMatches : t.hashDiffers}
                  </span>
                  <span className={s.verified ? "text-success" : "text-danger"}>{s.verified ? t.verified : t.notVerified}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Escrow({ selected }: { selected: NonNullable<BankDemo["selected"]> }) {
  const { escrow, operations, statement } = selected;
  if (!escrow) return <p className="text-ink-soft">{t.escrowNone}</p>;
  return (
    <div className="flex flex-col gap-4">
      <SimulatorBadge className="self-start" />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted">{t.account}</dt>
        <dd className="break-all">{escrow.externalId}</dd>
        <dt className="text-muted">{t.status}</dt>
        <dd>{t.escrowStatus[escrow.status]}</dd>
        <dt className="text-muted">{t.deposited}</dt>
        <dd>
          <Money amount={escrow.deposited} />
        </dd>
        <dt className="text-muted">{t.released}</dt>
        <dd>
          <Money amount={escrow.released} />
        </dd>
        <dt className="text-muted">{t.refunded}</dt>
        <dd>
          <Money amount={escrow.refunded} />
        </dd>
      </dl>
      <h3 className="text-lg font-bold text-ink">{t.operations}</h3>
      {operations.length === 0 ? (
        <p className="text-muted">{t.operationsEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {operations.map((op) => (
            <li key={op.id} className="flex flex-col">
              <span className="text-ink">
                {t.opKinds[op.kind]}, <Money amount={op.amount} />, {t.opStatus[op.status]}
              </span>
              <span className="break-all text-ink-soft">
                {t.key}: {op.idempotencyKey}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-lg font-bold text-ink">{t.statement}</h3>
      {statement === null ? (
        <Alert tone="warning">{t.statementUnavailable}</Alert>
      ) : statement.length === 0 ? (
        <p className="text-muted">{t.statementEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {statement.map((e) => (
            <li key={e.externalRef} className="flex flex-col">
              <span className="text-ink">
                {t.opKinds[e.kind]}, <Money amount={e.amount} />, <DateText value={e.occurredAt} format="dateTime" />
              </span>
              <span className="break-all text-ink-soft">{e.externalRef}</span>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href="/operator/report" variant="ghost" className="self-start">
        {t.reconcile}
      </ButtonLink>
    </div>
  );
}

/** Сценарий показа банку. Только DEMO_MODE; роль не проверяется — ведущий переключает персоны по ходу показа. */
export default async function BankDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isDemoMode()) notFound();
  const sp = await searchParams;
  const demo = await getBankDemo({ deal: dealParam.parse(Array.isArray(sp.deal) ? sp.deal[0] : sp.deal) });
  const { selected } = demo;

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} />
      <div className="flex flex-col gap-6">
        <Alert tone="info" title={<SimulatorBadge />}>
          {t.simulatorNote}
        </Alert>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={t.railNow} footer={<ButtonLink href="/operator/demo" variant="secondary">{t.railChange}</ButtonLink>}>
            <p className="text-lg font-semibold text-ink">{t.railModes[demo.rail.mode] ?? demo.rail.mode}</p>
          </Card>
          <Card title={t.howTo} footer={<ButtonLink href="/demo" variant="secondary">{t.choosePersona}</ButtonLink>}>
            <p className="text-ink-soft">{t.howToText}</p>
          </Card>
        </div>

        <Card title={t.scenario}>
          <ol className="flex flex-col">
            {demo.steps.map((step, i) => (
              <Step key={step.key} step={step} index={i} />
            ))}
          </ol>
        </Card>

        <section aria-labelledby="deal" className="flex flex-col gap-4">
          <h2 id="deal" className="text-2xl font-extrabold text-ink">
            {t.dealSection}
          </h2>
          {demo.deals.length === 0 || !selected ? (
            <EmptyState title={t.noDeals} titleAs="h3" />
          ) : (
            <>
              <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Select
                  label={t.dealLabel}
                  name="deal"
                  defaultValue={String(selected.deal.number)}
                  options={demo.deals.map((d) => ({ value: String(d.number), label: t.dealOption(d.number, d.title, o.dealStatus[d.status]) }))}
                />
                <Button type="submit" variant="secondary">
                  {t.show}
                </Button>
              </form>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="flex min-w-0 flex-col gap-6">
                  <Card title={t.journal} description={t.journalHint}>
                    {selected.history.length === 0 ? <p className="text-muted">{t.journalEmpty}</p> : <AuditList events={selected.history} />}
                  </Card>
                </div>
                <div className="flex min-w-0 flex-col gap-6">
                  <Card title={t.summary}>
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                      <dt className="text-muted">{t.dealLabel}</dt>
                      <dd className="break-words">
                        {t.deal(selected.deal.number)}, {selected.deal.title}
                      </dd>
                      <dt className="text-muted">{t.amount}</dt>
                      <dd>
                        <Money amount={selected.deal.totalAmount} />
                      </dd>
                      <dt className="text-muted">{t.status}</dt>
                      <dd>{o.dealStatus[selected.deal.status]}</dd>
                      <dt className="text-muted">{t.mode}</dt>
                      <dd>{o.paymentModes[selected.deal.paymentMode]}</dd>
                    </dl>
                    <h3 className="text-lg font-bold text-ink">{t.stages}</h3>
                    <ol className="flex flex-col gap-1">
                      {selected.deal.stages.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-ink">
                            {s.order}. {s.title}
                          </span>
                          <Money amount={s.amount} className="text-ink-soft" />
                          <StatusBadge tone="neutral">{o.stageStatus[s.status]}</StatusBadge>
                        </li>
                      ))}
                    </ol>
                  </Card>
                  <Card title={t.documents}>
                    <Documents documents={selected.documents} />
                  </Card>
                  <Card title={t.escrow}>
                    <Escrow selected={selected} />
                  </Card>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </Container>
  );
}
