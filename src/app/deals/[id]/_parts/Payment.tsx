import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { ButtonLink, Card, Fact, formatMoney, Money, SimulatorBadge, StatusBadge } from "@/ui";
import { ActionButton } from "../../_parts/ActionButton";
import { retryOperationAction } from "../actions";
import { paidAmount } from "./order-view";

const t = ru.deal;
const p = ru.payments;

/**
 * «Оплата» (макет 10, экран 3). Оплата по этапам: заказчик платит исполнителю напрямую, площадка хранит отметки —
 * только «оплата по этапам под контролем», без слов про защищённый счёт. Эскроу (банк или симулятор) — счёт сделки,
 * реквизиты и операции банка.
 */
export function Payment({ deal }: { deal: DealView }) {
  return deal.paymentMode === "MANUAL" ? <ManualPayment deal={deal} /> : <EscrowAccount deal={deal} />;
}

function ManualPayment({ deal }: { deal: DealView }) {
  const paid = paidAmount(deal.stages);
  return (
    <Card as="section" title={t.sections.payment} description={t.view.paymentManual}>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Fact label={t.view.paid}>
          <Money amount={paid} />
        </Fact>
        <Fact label={t.view.toPay}>
          <Money amount={Math.max(deal.totalAmount - paid, 0)} />
        </Fact>
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
