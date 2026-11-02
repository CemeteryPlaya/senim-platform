import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { getBankDemo, isDemoMode, type ScenarioStep } from "@/modules/operator";
import { Alert, Button, ButtonLink, Card, Container, EmptyState, Fact, PageHeader, Select, StatusBadge } from "@/ui";
import { formatTiyn } from "@/ui/format";
import { PersonaButton } from "../demo/PersonaButton";
import { AuditList } from "../operator/_components/AuditList";
import { DealDocuments } from "../operator/_components/DealDocuments";
import { MoneyBlockView, MoneyJournal } from "../operator/_components/MoneyJournal";

const t = ru.bankDemo;
const o = ru.operator;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

const dealParam = z.coerce.number().int().positive().optional().catch(undefined);

function Step({ step, index }: { step: ScenarioStep; index: number }) {
  const s = t.steps[step.key];
  const ref = step.number === undefined ? null : step.key === "offers" ? t.request(step.number) : t.deal(step.number);
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
        step.persona ? (
          <PersonaButton userId={step.persona.userId} name={step.persona.name} next={step.href} label={t.openAs(step.persona.name)} role={step.persona.role} />
        ) : (
          <ButtonLink href={step.href} variant="secondary" className="self-start">
            {t.open}
          </ButtonLink>
        )
      ) : (
        <p className="text-muted">{t.missing}</p>
      )}
    </li>
  );
}

/**
 * Сценарий показа банку (docs/bank/05-demo-script.md). Только DEMO_MODE; роль не проверяется — ведущий
 * переключает персоны по ходу показа. Честная пометка: тестовые данные, банк без API, операции — оператор.
 */
export default async function BankDemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isDemoMode()) notFound();
  const sp = await searchParams;
  const demo = await getBankDemo({ deal: dealParam.parse(Array.isArray(sp.deal) ? sp.deal[0] : sp.deal) });
  const { selected } = demo;

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} back={{ href: "/" }} />
      <div className="flex flex-col gap-6">
        <Alert tone="warning">{t.honestNote}</Alert>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          <Card title={t.providerNow}>
            <p className="text-lg font-semibold text-ink">{t.providerNames[demo.newDealProvider]}</p>
            {demo.newDealProvider !== "manual" && <p className="text-base text-ink-soft">{t.providerHint}</p>}
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
                  defaultValue={String(selected.card.deal.number)}
                  options={demo.deals.map((d) => ({ value: String(d.number), label: t.dealOption(d.number, d.title, o.dealStatus[d.status]) }))}
                />
                <Button type="submit" variant="secondary">
                  {t.show}
                </Button>
              </form>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="flex min-w-0 flex-col gap-6">
                  <MoneyBlockView money={selected.card.money} />
                  <Card title={t.money} description={o.deals.card.journalHint}>
                    <MoneyJournal rows={selected.card.journal} />
                  </Card>
                  <Card title={t.journal} description={t.journalHint}>
                    {selected.history.length === 0 ? <p className="text-muted">{t.journalEmpty}</p> : <AuditList events={selected.history} />}
                  </Card>
                </div>
                <div className="flex min-w-0 flex-col gap-6">
                  <Card title={t.summary}>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="info">{o.dealStatus[selected.card.deal.status]}</StatusBadge>
                      <StatusBadge tone="neutral">{o.providers[selected.card.deal.provider]}</StatusBadge>
                    </div>
                    <dl className="flex flex-col gap-4">
                      <Fact label={t.dealLabel}>{o.money.deal(selected.card.deal.number, selected.card.deal.title)}</Fact>
                      <Fact label={o.deals.card.price}>{formatTiyn(selected.card.deal.priceTiyn)}</Fact>
                      <Fact label={o.deals.card.buyerTotal}>{formatTiyn(selected.card.deal.buyerTotalTiyn)}</Fact>
                      <Fact label={o.deals.card.payout}>{formatTiyn(selected.card.deal.payoutTiyn)}</Fact>
                      <Fact label={o.deals.card.platformIncome}>{formatTiyn(selected.card.deal.platformIncomeTiyn)}</Fact>
                    </dl>
                  </Card>
                  <Card title={t.documents}>
                    <DealDocuments documents={selected.card.documents} />
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
