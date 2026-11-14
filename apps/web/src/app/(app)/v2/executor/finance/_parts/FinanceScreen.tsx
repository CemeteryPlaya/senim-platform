import { ChevronLeft, ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Bars, ButtonLink, Card, EmptyState, Explain, List, ListRow, Money, PageTitle, Section, Split, Stack, Stat } from "@/kit";
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
                <span className="text-card wrap-break-word text-ink">{row.title}</span>
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

/** Месяц со стрелками (ссылки с `?month=`), сумма «Получено за месяц» и сравнение с прошлым месяцем. */
function MonthCard({ view }: { view: FinanceView }) {
  const n = t.monthNav;
  return (
    <Card className="flex flex-col gap-4">
      <nav aria-label={n.label} className="flex items-center justify-between gap-2">
        <ButtonLink variant="secondary" className="w-control px-0" href={view.prevHref} aria-label={n.prev} title={n.prev}>
          <ChevronLeft aria-hidden className="size-6 shrink-0" />
        </ButtonLink>
        <h2 className="min-w-0 flex-1 text-center text-section text-ink">{view.title}</h2>
        {view.nextHref ? (
          <ButtonLink variant="secondary" className="w-control px-0" href={view.nextHref} aria-label={n.next} title={n.next}>
            <ChevronRight aria-hidden className="size-6 shrink-0" />
          </ButtonLink>
        ) : (
          <span aria-hidden className="w-control shrink-0" />
        )}
      </nav>
      <div className="flex flex-col gap-1">
        <Stat label={t.total} value={<Money tiyn={view.totalTiyn} />} compact />
        {view.versus && <p className="text-sub text-muted">{view.versus}</p>}
      </div>
    </Card>
  );
}

function Awaiting({ awaiting, device }: { awaiting: NonNullable<FinanceView["awaiting"]>; device: Device }) {
  const a = t.awaiting;
  return (
    <Section title={a.title} id="fin-awaiting">
      <Card className="flex flex-col gap-2">
        <Stat label={a.label} value={<Money tiyn={awaiting.totalTiyn} />} compact />
        <div>
          <Explain label={a.explain.label} title={a.explain.title} device={device}>
            {a.explain.points.map((point) => (
              <p key={point} className="mb-2 last:mb-0">
                {point}
              </p>
            ))}
          </Explain>
        </div>
      </Card>
      <Payments rows={awaiting.rows} />
    </Section>
  );
}

/**
 * «Финансы» мастера: месяц со стрелками и «Получено за месяц», столбики за шесть месяцев, оплаты месяца списком
 * (сделка, дата, сумма) и «Ожидает после приёмки». Суммы — готовые из журнала денег. Нет ни одной оплаты и ничего в
 * ожидании — обучающий пустой экран. Телефон — колонкой; компьютер — оплаты слева, столбики и ожидающее справа.
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
  const chart = (
    <Section title={t.chart.title} id="fin-chart">
      <Card>
        <Bars label={t.chart.label} items={view.bars.map(({ selected, ...bar }) => ({ ...bar, current: selected }))} />
      </Card>
    </Section>
  );
  const awaiting = view.awaiting && <Awaiting awaiting={view.awaiting} device={device} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              <MonthCard view={view} />
              {payments}
            </Stack>
          }
          aside={
            <Stack gap="section">
              {chart}
              {awaiting}
            </Stack>
          }
        />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      <MonthCard view={view} />
      {chart}
      {payments}
      {awaiting}
    </Stack>
  );
}
