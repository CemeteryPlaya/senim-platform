import type { Metadata } from "next";
import { CalendarClock, CheckCircle2, Hammer, Hourglass, Wallet } from "lucide-react";
import { getExecutorFinance, type FinanceRow, type FinanceState } from "@/modules/deal-core";
import { activeRailMode } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { Alert, Container, EmptyState, FilterChips, Money, PageHeader, PhotoCard, SectionTitle, Stat, StatusBadge, formatDate, type Tone } from "@/ui";
import { NoAccess } from "@/app/_components/NoAccess";
import { photo } from "@/app/_home/illustration";
import { pageUser } from "@/app/requests/_parts/guard";

const t = ru.executor.finance;

export const metadata: Metadata = { title: t.metaTitle };

const FILTERS = ["all", "expected", "upcoming", "received"] as const;
type Filter = (typeof FILTERS)[number];
const isFilter = (v: string | undefined): v is Filter => (FILTERS as readonly string[]).includes(v ?? "");

/**
 * «Финансы» исполнителя по макету 12 (стр. 4): сводка — получено, ожидается по принятым этапам, в работе;
 * список оплат по этапам из его сделок. Только чтение: подтверждение оплаты — на странице сделки.
 * Комиссии нет (ответ №3) — её строки нет.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/finance");
  if (!user) return <NoAccess description={ru.requests.noAccessExecutor} />;

  const [finance, rail] = await Promise.all([getExecutorFinance(user), activeRailMode()]);
  const escrow = finance.hasEscrow || rail !== "manual";
  const show: Filter = isFilter(sp.show) ? sp.show : "all";
  const rows = show === "all" ? finance.rows : finance.rows.filter((r) => r.state === show);
  const count = (state: FinanceState) => finance.rows.filter((r) => r.state === state).length;
  const toConfirm = finance.rows.filter((r) => r.state === "expected" && r.payment === "MARKED_PAID").length;

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={escrow ? t.leadEscrow : t.leadManual} back={{ href: "/" }} className="pb-0" />

      <section aria-label={t.totalsLabel} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3">
        <div className="col-span-full flex min-w-0 items-center gap-4 rounded-card bg-primary p-5 text-on-primary shadow-card sm:p-6">
          <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-control bg-surface text-primary [&_svg]:size-6">
            <Wallet />
          </span>
          <p className="flex min-w-0 flex-col">
            <span className="text-3xl leading-tight font-extrabold tabular-nums">
              <Money amount={finance.totals.received} />
            </span>
            <span className="text-base">{t.totals.received}</span>
          </p>
        </div>
        <Stat icon={<Hourglass />} value={<Money amount={finance.totals.expected} />} label={t.totals.expected} />
        <Stat icon={<Hammer />} value={<Money amount={finance.totals.upcoming} />} label={t.totals.upcoming} />
      </section>

      {toConfirm > 0 && (
        <Alert tone="accent" title={t.confirmTitle}>
          {t.confirmText(toConfirm)}
        </Alert>
      )}

      {finance.rows.length === 0 ? (
        <EmptyState icon={<Wallet />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <section aria-labelledby="finance-list" className="flex flex-col gap-4">
          <SectionTitle id="finance-list" title={t.listTitle} />
          <FilterChips
            label={t.filterLabel}
            current={show}
            chips={FILTERS.map((f) => ({
              key: f,
              label: t.filter[f],
              count: f === "all" ? finance.rows.length : count(f),
              href: f === "all" ? "/executor/finance" : `/executor/finance?show=${f}`,
            }))}
          />
          {rows.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-base text-ink-soft shadow-card">{t.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
              {rows.map((r) => (
                <PaymentCard key={r.stageId} row={r} />
              ))}
            </ul>
          )}
        </section>
      )}

      <Alert tone="info">{escrow ? t.noteEscrow : t.noteManual}</Alert>
    </Container>
  );
}

/** Статус оплаты простыми словами: что уже есть и чего ждём. */
function status(r: FinanceRow): { tone: Tone; text: string } {
  const s = t.status;
  if (r.state === "received") return { tone: "success", text: s.received };
  if (r.state === "upcoming") return { tone: "neutral", text: r.paymentDue === "ON_START" ? s.advance : s.afterAcceptance };
  if (r.payment === "MARKED_PAID") return { tone: "accent", text: s.confirm };
  return r.mode === "MANUAL" ? { tone: "warning", text: s.waitClient } : { tone: "info", text: s.waitBank };
}

function PaymentCard({ row: r }: { row: FinanceRow }) {
  const st = status(r);
  const date = r.date && (r.state === "received" ? t.receivedAt(formatDate(r.date)) : t.markedAt(formatDate(r.date)));
  return (
    <PhotoCard
      as="li"
      layout="row"
      href={`/deals/${r.dealId}`}
      linkLabel={`${r.dealTitle}. ${t.linkLabel(r.dealNumber, r.stageTitle)}`}
      image={photo(r.dealTitle)}
      title={r.dealTitle}
      badge={
        <StatusBadge tone={st.tone} icon={r.state === "received" ? <CheckCircle2 /> : undefined}>
          {st.text}
        </StatusBadge>
      }
      meta={[{ text: t.stageLine(r.dealNumber, r.stageTitle) }, ...(date ? [{ icon: <CalendarClock />, text: date }] : [])]}
      aside={<Money amount={r.amount} />}
    />
  );
}
