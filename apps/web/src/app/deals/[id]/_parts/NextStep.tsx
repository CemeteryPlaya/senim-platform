import type { ReactNode } from "react";
import { SignLink } from "@/app/_components/signing";
import type { BankConsentState, DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { isEnabled } from "@/platform/features";
import { Alert, ButtonLink, Card, formatTiyn } from "@/ui";
import { ActionButton } from "../../_parts/ActionButton";
import { startWorkAction } from "../actions";
import { BankConsentBox } from "./BankConsent";
import { ReviewForm } from "./DealForms";
import { readyFarWarning } from "./deal-view";
import { NEXT_HEADING_ID } from "./next-step";
import { PayButton, ReadyForm } from "./WorkForms";

const t = ru.deal;

/**
 * «Что дальше» — текущее событие сделки: одна строка о том, что происходит, предупреждения шага и, если действие —
 * форма (сдача работы, отзыв), сама форма. Действие одной кнопкой — в StickyAction (stepAction ниже).
 * До оплаты (CREATED) — отметка стороны «Передача данных банку-партнёру» (bank, P3): пока её нет, подпись оферты мастера и
 * оплата покупателя закрыты; покупателю, который отметил, а мастер ещё нет, — чего ждём.
 */
export function NextStep({ deal, bank }: { deal: DealView; bank: BankConsentState | null }) {
  const { action, mine } = deal.next;
  const far = readyFarWarning(deal);
  const side = deal.viewer === "CLIENT" || deal.viewer === "EXECUTOR" ? deal.viewer : null;
  return (
    <Card as="section" title={t.sections.next} titleId={NEXT_HEADING_ID}>
      <p className="text-lg text-ink">{t.next[action]}</p>
      {bank && side && !bank.mine && <BankConsentBox dealId={deal.id} side={side} />}
      {bank?.mine && <p className="text-base text-ink-soft">{ru.consent.bank.given}</p>}
      {bank?.mine && !bank.other && side === "CLIENT" && action === "pay" && <Alert tone="info">{ru.consent.bank.waitExecutor}</Alert>}
      {/* Сразу под заголовком, на который после сдачи переходит фокус; объявляет плашка раздела «Сдача». */}
      {far && <Alert tone="warning">{far}</Alert>}
      {manualTransfer(deal) && <p className="text-base text-ink-soft">{t.pay.manualHint(formatTiyn(deal.estimate.totalTiyn))}</p>}
      {mine && action === "submitReady" && <ReadyForm dealId={deal.id} />}
      {mine && action === "leaveReview" && <ReviewForm dealId={deal.id} portfolioConsent={isEnabled("dealPortfolio")} />}
    </Card>
  );
}

/** manual: оплата создана и ждёт банк — покупателю сказать, куда переводить (реквизиты — в оферте). */
const manualTransfer = (deal: DealView) => deal.viewer === "CLIENT" && deal.paymentProvider === "MANUAL" && deal.next.action === "waitPaymentConfirmation";

/**
 * Единственное главное действие шага смотрящего (deal-core.nextStep) — содержимое StickyAction; null — действия нет
 * (ждём другую сторону или банк) или оно — форма в «Что дальше». Подпись — переход к панели документа ниже.
 * Без отметки о передаче данных банку-партнёру (bankLocked) подпись оферты мастера и оплата закрыты: главное действие —
 * сама отметка в «Что дальше».
 */
export function stepAction(deal: DealView, bank: BankConsentState | null): ReactNode {
  if (!deal.next.mine) return null;
  if (bankLocked(deal, bank)) return null;
  switch (deal.next.action) {
    case "signContract":
      return deal.contract && <SignLink documentId={deal.contract.id} fullWidth>{t.actions.signContract}</SignLink>;
    case "pay":
      return <PayButton dealId={deal.id} amount={formatTiyn(deal.estimate.totalTiyn)} />;
    case "startWork":
      return (
        <ActionButton action={startWorkAction} input={{ dealId: deal.id }} focusAfter={NEXT_HEADING_ID}>
          {t.actions.startWork}
        </ActionButton>
      );
    case "signAct":
      return deal.act && <SignLink documentId={deal.act.id} fullWidth>{t.actions.signAct}</SignLink>;
    case "signActEcp":
      return deal.act && <SignLink documentId={deal.act.id} fullWidth>{t.actions.signActEcp}</SignLink>;
    case "resolveDispute":
      return deal.dispute && <ButtonLink href={`/operator/disputes/${deal.dispute.id}`} fullWidth>{t.actions.resolveDispute}</ButtonLink>;
    default:
      return null;
  }
}

/**
 * Шаг закрыт до отметки о передаче данных банку-партнёру: мастеру — подпись оферты (своя отметка), покупателю — оплата
 * (обе отметки: payForDeal иначе откажет BANK_CONSENT_MISSING).
 */
export function bankLocked(deal: DealView, bank: BankConsentState | null): boolean {
  if (!bank) return false;
  if (deal.viewer === "EXECUTOR" && deal.next.action === "signContract") return !bank.mine;
  if (deal.viewer === "CLIENT" && deal.next.action === "pay") return !bank.mine || !bank.other;
  return false;
}
