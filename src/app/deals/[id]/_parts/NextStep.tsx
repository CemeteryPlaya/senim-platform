import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { ButtonLink, Card, formatTiyn } from "@/ui";
import { ActionButton } from "../../_parts/ActionButton";
import { startWorkAction } from "../actions";
import { ReviewForm } from "./DealForms";
import { NEXT_HEADING_ID } from "./next-step";
import { PayButton, ReadyForm } from "./WorkForms";

const t = ru.deal;

/**
 * «Что дальше»: одна строка о том, что происходит, и единственное главное действие смотрящего (deal-core.nextStep).
 * Подпись оферты и акта — в панели документа ниже (компонент documents), сюда — переход к ней.
 */
export function NextStep({ deal }: { deal: DealView }) {
  const { action, mine } = deal.next;
  return (
    <Card as="section" title={t.sections.next} titleId={NEXT_HEADING_ID}>
      <p className="text-lg text-ink">{t.next[action]}</p>
      {manualTransfer(deal) && <p className="text-base text-ink-soft">{t.pay.manualHint(formatTiyn(deal.estimate.totalTiyn))}</p>}
      {mine && <PrimaryAction deal={deal} />}
    </Card>
  );
}

/** manual: оплата создана и ждёт банк — покупателю сказать, куда переводить (реквизиты — в оферте). */
const manualTransfer = (deal: DealView) => deal.viewer === "CLIENT" && deal.paymentProvider === "MANUAL" && deal.next.action === "waitPaymentConfirmation";

function PrimaryAction({ deal }: { deal: DealView }) {
  switch (deal.next.action) {
    case "signContract":
      return deal.contract && <ButtonLink href={`#doc-${deal.contract.id}`}>{t.actions.signContract}</ButtonLink>;
    case "pay":
      return <PayButton dealId={deal.id} amount={formatTiyn(deal.estimate.totalTiyn)} />;
    case "startWork":
      return (
        <ActionButton action={startWorkAction} input={{ dealId: deal.id }} focusAfter={NEXT_HEADING_ID}>
          {t.actions.startWork}
        </ActionButton>
      );
    case "submitReady":
      return <ReadyForm dealId={deal.id} />;
    case "signAct":
      return deal.act && <ButtonLink href={`#doc-${deal.act.id}`}>{t.actions.signAct}</ButtonLink>;
    case "signActEcp":
      return deal.act && <ButtonLink href={`#doc-${deal.act.id}`}>{t.actions.signActEcp}</ButtonLink>;
    case "resolveDispute":
      return deal.dispute && <ButtonLink href={`/operator/disputes/${deal.dispute.id}`}>{t.actions.resolveDispute}</ButtonLink>;
    case "leaveReview":
      return <ReviewForm dealId={deal.id} />;
    default:
      return null;
  }
}
