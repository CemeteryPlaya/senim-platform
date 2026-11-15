import { ChevronLeft, ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import Link from "next/link";
import { Bars, Card, EmptyState, Explain, List, ListRow, Money, MoneyPanel, PageTitle, Section, Split, Stack, Stat } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../../../_shell/paths";
import type { FinanceView, PaymentRow } from "./finance-view";

const t = ru.app.masterFinance;

/** Строки «сделка — дата — сумма»: строка ведёт в сделку. */
function Payments({ rows }: { rows: readonly PaymentRow[] }) {
  return (
    <Card padded={false}>
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            href={row.href}
            label={
              <span className="flex flex-col items-start gap-1">
                <span className="text-headline wrap-break-word text-ink">{row.title}</span>
                <span className="text-sub text-muted">{row.line}</span>
              </span>
            }
            value={<Money tiyn={row.amountTiyn} />}
          />
        ))}
      </List>
    </Card>
  );
}

/** Круглая стрелка месяца 48 px: без заливки в покое (тихая), при наведении — fill. */
const ARROW = "inline-flex size-control shrink-0 items-center justify-center rounded-full text-ink no-underline pressable hover:bg-fill";

/**
 * Месяц со стрелками (ссылки с `?month=`), сумма «Получено за месяц» и сравнение с прошлым месяцем. Переключатель
 * симметричный: «‹ Ноябрь 2026 ›» — у текущего месяца стрелка «вперёд» на месте, но погашена (не ссылка, диктору не видна).
 */
function MonthCard({ view }: { view: FinanceView }) {
  const n = t.monthNav;
  return (
    <Card className="flex flex-col gap-4">
      <nav aria-label={n.label} className="flex items-center justify-between gap-2">
        <Link className={ARROW} href={view.prevHref} aria-label={n.prev} title={n.prev}>
          <ChevronLeft aria-hidden className="size-6 shrink-0" />
        </Link>
        <h2 className="min-w-0 flex-1 text-center text-title-2 text-ink">{view.title}</h2>
        {view.nextHref ? (
          <Link className={ARROW} href={view.nextHref} aria-label={n.next} title={n.next}>
            <ChevronRight aria-hidden className="size-6 shrink-0" />
          </Link>
        ) : (
          <span aria-hidden className="inline-flex size-control shrink-0 items-center justify-center text-muted opacity-40">
            <ChevronRight className="size-6 shrink-0" />
          </span>
        )}
      </nav>
      <div className="flex flex-col gap-1">
        <Stat label={t.total} value={<Money tiyn={view.totalTiyn} tone={view.totalTiyn === 0n ? "inherit" : "ink"} />} compact muted={view.totalTiyn === 0n} />
        {view.versus && <p className="text-sub text-muted">{view.versus}</p>}
      </div>
    </Card>
  );
}

/**
 * «Ожидает после приёмки» — героем экрана (разбор 3.1): зелёный блок денег «Деньги в банке под защитой» с крупной суммой,
 * пояснение и сделки, за которые деньги ждут приёмки.
 */
function Awaiting({ awaiting, device }: { awaiting: NonNullable<FinanceView["awaiting"]>; device: Device }) {
  const a = t.awaiting;
  return (
    <Section title={a.title} id="fin-awaiting">
      <MoneyPanel tone="protected" title={a.label} amount={awaiting.totalTiyn} device={device} />
      <div>
        <Explain label={a.explain.label} title={a.explain.title} device={device}>
          {a.explain.points.map((point) => (
            <p key={point} className="mb-2 last:mb-0">
              {point}
            </p>
          ))}
        </Explain>
      </div>
      <Payments rows={awaiting.rows} />
    </Section>
  );
}

/**
 * «Финансы» мастера: «Ожидает после приёмки» героем (если есть), месяц со стрелками и «Получено за месяц», столбики за
 * шесть месяцев (только если хоть один месяц не пустой — шесть нулевых полос не рисуем), оплаты месяца списком (сделка,
 * дата, сумма). Суммы — готовые из журнала денег. Нет ни одной оплаты и ничего в ожидании — обучающий пустой экран.
 * Телефон — колонкой; компьютер — слева деньги и оплаты, справа столбики (нет столбиков — одна колонка по центру).
 * Главного действия нет: экран только для чтения.
 */
export function FinanceScreen({ view, device }: { view: FinanceView; device: Device }) {
  const title = <PageTitle title={t.title} back={{ href: to("/executor/profile"), label: t.back }} />;
  if (view.empty) {
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.empty.title} body={t.empty.body} action={{ href: to("/executor/requests"), label: t.empty.action }} />
      </Stack>
    );
  }
  const payments = (
    <Section title={t.payments.title} id="fin-payments">
      {view.payments.length === 0 ? <EmptyState title={t.payments.empty.title} body={t.payments.empty.body} /> : <Payments rows={view.payments} />}
    </Section>
  );
  const chart = view.bars.some((bar) => bar.value > 0n) && (
    <Section title={t.chart.title} id="fin-chart">
      <Card>
        <Bars label={t.chart.label} items={view.bars.map(({ selected, ...bar }) => ({ ...bar, current: selected }))} />
      </Card>
    </Section>
  );
  const awaiting = view.awaiting && <Awaiting awaiting={view.awaiting} device={device} />;
  const main = (
    <Stack gap="section">
      {awaiting}
      <MonthCard view={view} />
      {payments}
    </Stack>
  );

  if (device === "desktop") {
    if (!chart) {
      return (
        <Stack gap="section" className="mx-auto w-full max-w-home">
          {title}
          {main}
        </Stack>
      );
    }
    return (
      <Stack gap="section">
        {title}
        <Split main={main} aside={chart} />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      {awaiting}
      <MonthCard view={view} />
      {chart}
      {payments}
    </Stack>
  );
}
