import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Chips, Columns, Money, PageTitle, Section, Stack, Stat, StatRow, type ChipItem } from "@/kit";
import { ADMIN_PERIODS, adminStats, isAdminPeriod, type AdminPeriod, type StatusCount } from "@/modules/admin";
import { pageHref, requireAdmin } from "../../_shell/auth";
import { TableOrCards } from "../operator/_parts/TableOrCards";
import { statusLabel, type StatusTableKind } from "./_parts/status-label";
import { first, type SearchParams } from "./_parts/values";

const t = ru.app.admin.stats;

export const metadata: Metadata = { title: t.metaTitle };

/** Период по умолчанию: без `?period=` — последние 30 дней. */
const DEFAULT_PERIOD: AdminPeriod = "30d";
const FUNNEL = ["published", "withOffer", "dealCreated", "paid", "accepted", "paidOut"] as const;

type Props = { searchParams: Promise<SearchParams> };

function periodChips(current: AdminPeriod): ChipItem[] {
  return ADMIN_PERIODS.map((period) => ({
    href: pageHref("/admin", period === DEFAULT_PERIOD ? {} : { period }),
    label: t.period[period],
    active: period === current,
  }));
}

function StatusTable<S extends string>({ id, title, rows }: { id: StatusTableKind; title: string; rows: readonly StatusCount<S>[] }) {
  return (
    <Section title={title} id={id}>
      <TableOrCards
        caption={title}
        captionHidden
        rows={rows}
        rowKey={(r) => r.status}
        empty={t.empty}
        footer={{ status: t.total, count: rows.reduce((acc, r) => acc + r.count, 0) }}
        columns={[
          { key: "status", header: t.columns.status, rowHeader: true, cell: (r) => statusLabel(id, r.status) },
          { key: "count", header: t.columns.count, numeric: true, cell: (r) => r.count },
        ]}
      />
    </Section>
  );
}

/**
 * Дом администратора — статистика платформы за период (ссылки `?period=`: работают без JavaScript и ссылкой). Деньги —
 * только из журнала денег (модуль admin), суммы — тиыны через `Money`. Главной кнопки нет: экран только показывает;
 * «Назад» нет — это дом роли. Права проверяет модуль (роль и второй фактор), страница — ворота экрана.
 */
export default async function AdminHome({ searchParams }: Props) {
  const sp = await searchParams;
  const user = await requireAdmin(pageHref("/admin", sp));
  const raw = first(sp.period);
  const period = isAdminPeriod(raw) ? raw : DEFAULT_PERIOD;
  const stats = await adminStats(user, period);

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <Chips label={t.periodLabel} items={periodChips(period)} />
      <Section title={t.money.title} id="money">
        <StatRow label={t.money.title}>
          <Stat compact label={t.money.paid} value={<Money tiyn={stats.money.paidTiyn} />} />
          <Stat compact label={t.money.payout} value={<Money tiyn={stats.money.payoutTiyn} />} />
          <Stat compact label={t.money.refund} value={<Money tiyn={stats.money.refundTiyn} />} />
          <Stat compact label={t.money.income} value={<Money tiyn={stats.money.incomeTiyn} />} />
        </StatRow>
      </Section>
      <Section title={t.funnel.title} id="funnel">
        <p className="text-body text-muted">{t.funnel.lead}</p>
        <StatRow label={t.funnel.title}>
          {FUNNEL.map((step) => (
            <Stat key={step} label={t.funnel.steps[step]} value={stats.funnel[step]} muted={stats.funnel[step] === 0} />
          ))}
        </StatRow>
      </Section>
      <Columns count={3}>
        <StatusTable id="requests" title={t.requests} rows={stats.requests} />
        <StatusTable id="deals" title={t.deals} rows={stats.deals} />
        <StatusTable id="masters" title={t.masters} rows={stats.masters} />
      </Columns>
    </Stack>
  );
}
