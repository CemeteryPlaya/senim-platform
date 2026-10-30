import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, Card, formatDateTime } from "@/ui";
import { ActionButton } from "../../_parts/ActionButton";
import { confirmPaymentAction, markPaidAction, startStageAction } from "../actions";
import { ReviewForm } from "./DealForms";
import { ReviewStage, SubmitStageForm } from "./StageForms";

const t = ru.deal;

/** «Что дальше»: подсказка и единственное главное действие для того, кто смотрит. */
export function NextStepCard({ deal }: { deal: DealView }) {
  const { text, action } = deal.next;
  const stage = action && "stageId" in action ? deal.stages.find((s) => s.id === action.stageId) : undefined;

  return (
    <Card as="section" title={t.sections.next}>
      <div className="flex flex-col gap-5">
        <p className="text-lg text-ink">{text}</p>
        {stage?.status === "SUBMITTED" && stage.autoAcceptAt && deal.viewer === "CLIENT" && (
          <Alert tone="warning">{t.autoAcceptHint(formatDateTime(stage.autoAcceptAt))}</Alert>
        )}
        {action && <PrimaryAction deal={deal} action={action} />}
      </div>
    </Card>
  );
}

function PrimaryAction({ deal, action }: { deal: DealView; action: NonNullable<DealView["next"]["action"]> }) {
  switch (action.kind) {
    case "signDocument":
      // Подпись — в панели документа ниже (_components/signing): просмотр PDF, хэш, ЭЦП.
      return (
        <ButtonLink href={`#doc-${action.documentId}`} fullWidth>
          {t.actions.goSign}
        </ButtonLink>
      );
    case "deposit":
      return action.accountId && deal.paymentMode === "ESCROW_SIMULATOR" ? (
        <ButtonLink href={`/simulator/bank/${action.accountId}`} fullWidth>
          {t.actions.toBank}
        </ButtonLink>
      ) : null;
    case "markPaid":
      return (
        <ActionButton
          action={markPaidAction}
          input={{ stageId: action.stageId }}
          confirm={{ title: t.forms.markPaidTitle, text: t.forms.markPaidText, yes: t.forms.markPaidConfirm, no: ru.common.actions.notNow, tone: "primary" }}
        >
          {t.actions.markPaid}
        </ActionButton>
      );
    case "confirmPayment":
      return (
        <ActionButton action={confirmPaymentAction} input={{ stageId: action.stageId }}>
          {t.actions.confirmPayment}
        </ActionButton>
      );
    case "start":
      return (
        <ActionButton action={startStageAction} input={{ stageId: action.stageId }}>
          {t.actions.start}
        </ActionButton>
      );
    case "submit":
      return <SubmitStageForm stageId={action.stageId} />;
    case "accept":
      return <ReviewStage stageId={action.stageId} />;
    case "review":
      return <ReviewForm dealId={deal.id} />;
  }
}
