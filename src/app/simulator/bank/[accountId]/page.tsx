import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getCurrentUser } from "@/modules/identity";
import { getSimulatorAccount } from "@/modules/payments";
import { ru } from "@/i18n/ru";
import { isAppError } from "@/platform/errors";
import { Banner, ButtonLink, Card, Container, DateText, Fact, Money, PageHeader, SimulatorBadge, StatusBadge } from "@/ui";
import { DepositForm, RedeliverButton } from "./SimulatorControls";

const t = ru.payments.simulator;
const a = ru.payments.account;

export const metadata: Metadata = { title: t.title };

type Props = { params: Promise<{ accountId: string }> };

/** Банк-симулятор: счёт сделки «глазами банка». Честно подписан: не настоящие деньги. */
export default async function SimulatorBankPage({ params }: Props) {
  const { accountId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/simulator/bank/${accountId}`)}`);
  const account = await getSimulatorAccount(user, accountId).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const needed = Math.max(0, account.deal.totalAmount - account.balance);

  return (
    <>
      <Banner tone="warning" icon={<FlaskConical aria-hidden className="size-6" />}>
        <span className="text-lg font-extrabold">{t.warning}</span>
      </Banner>
      <Container size="form">
        <PageHeader
          title={t.title}
          description={t.accountFor(account.deal.number)}
          back={{ href: `/deals/${account.deal.id}`, label: t.backToDeal }}
          actions={<SimulatorBadge />}
        />
        <div className="flex flex-col gap-6">
          <p className="text-lg text-ink">{t.warningText}</p>

          <Card as="section" title={a.title}>
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <Fact label={a.number}>
                <span className="font-mono break-all">{account.externalId}</span>
              </Fact>
              <Fact label={a.iban}>
                <span className="font-mono break-all">{account.requisites.iban}</span>
              </Fact>
              <Fact label={t.expected}>
                <Money amount={account.deal.totalAmount} />
              </Fact>
              <Fact label={a.balance}>
                <Money amount={account.balance} />
              </Fact>
              <Fact label={a.purpose}>{account.requisites.paymentPurpose}</Fact>
              <Fact label={a.bik}>{account.requisites.bik}</Fact>
            </dl>
            <div className="mt-4">
              <StatusBadge tone={account.status === "OPENED" ? "info" : "success"}>{a.status[account.status]}</StatusBadge>
            </div>
          </Card>

          {account.canDeposit && account.deal.status === "AWAITING_DEPOSIT" && (
            <Card as="section" title={t.deposit}>
              <DepositForm accountId={account.accountId} defaultAmount={needed || account.deal.totalAmount} />
            </Card>
          )}

          <Card as="section" title={t.statement}>
            {account.statement.length === 0 ? (
              <p className="text-base text-muted">{t.statementEmpty}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-base">
                  <caption className="sr-only">{t.statement}</caption>
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-semibold">{t.columns.date}</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">{t.columns.kind}</th>
                      <th scope="col" className="py-2 pr-3 font-semibold">{t.columns.amount}</th>
                      <th scope="col" className="py-2 font-semibold">{t.columns.ref}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.statement.map((e) => (
                      <tr key={e.externalRef} className="border-t border-line text-ink">
                        <td className="py-2 pr-3">
                          <DateText value={e.occurredAt} format="dateTime" />
                        </td>
                        <td className="py-2 pr-3">{ru.payments.operation.kind[e.kind]}</td>
                        <td className="py-2 pr-3">
                          <Money amount={e.kind === "DEPOSIT" ? e.amount : -e.amount} />
                        </td>
                        <td className="py-2 font-mono">{e.externalRef}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {account.hasEvents && (
            <Card as="section" title={t.redeliver}>
              <RedeliverButton accountId={account.accountId} />
            </Card>
          )}

          <ButtonLink href={`/deals/${account.deal.id}`} variant="secondary" fullWidth>
            {t.backToDeal}
          </ButtonLink>
        </div>
      </Container>
    </>
  );
}

