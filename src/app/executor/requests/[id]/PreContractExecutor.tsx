import { ru } from "@/i18n/ru";
import type { IncomingRequest } from "@/modules/requests";
import { Alert, formatMoney } from "@/ui";
import { ActionButton } from "@/app/requests/_parts/ActionButton";
import { confirmDepositAction } from "@/app/_components/pre-contract/actions";
import { ProjectForm } from "@/app/_components/pre-contract/ProjectForm";
import { ProjectView } from "@/app/_components/pre-contract/ProjectView";

/** Шаги до договора на экране исполнителя выбранного отклика (ADR-005): залог и проект. */

const p = ru.requests.pre;
type Pre = IncomingRequest["pre"];
type MyOffer = NonNullable<IncomingRequest["myOffer"]>;

/** Сценарий 4: заказчик вносит залог напрямую исполнителю, исполнитель подтверждает получение. */
export function DepositExecutor({ pre, offerId }: { pre: Pre; offerId: string }) {
  const amount = formatMoney(pre.deposit?.amount ?? pre.depositAmount);
  if (pre.deposit?.status !== "MARKED_PAID") {
    return (
      <Alert tone="info" title={p.deposit.title}>
        {p.deposit.executorWait(amount)}
      </Alert>
    );
  }
  return (
    <>
      <Alert tone="accent" title={p.deposit.title}>
        {p.deposit.executorMarked(amount)}
      </Alert>
      <ActionButton
        action={confirmDepositAction}
        input={{ offerId }}
        confirm={{ title: p.deposit.confirmConfirmTitle, text: p.deposit.confirmConfirmText, yes: p.deposit.confirmConfirm, no: ru.common.actions.cancel, tone: "primary" }}
      >
        {p.deposit.confirm}
      </ActionButton>
    </>
  );
}

/** Проект: форма первой или новой версии, иначе — отправленная версия и её статус. */
export function ExecutorProject({ pre, offer }: { pre: Pre; offer: MyOffer }) {
  const latest = pre.projects[0];
  const afterContract = !pre.rules.projectBeforeContract;
  const lead =
    afterContract && pre.tolerance ? p.project.executorLeadAfterContract(formatMoney(pre.tolerance.min), formatMoney(pre.tolerance.max)) : p.project.executorLead;

  if (!latest || latest.status === "CHANGES_REQUESTED") {
    const price = offer.measurement?.finalPrice ?? offer.price;
    const initial = latest
      ? { materials: latest.materials, costLines: latest.costLines, durationDays: latest.durationDays, warrantyMonths: latest.warrantyMonths }
      : { materials: "", costLines: [{ title: "", amount: price }], durationDays: offer.durationDays, warrantyMonths: offer.warrantyMonths };
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold text-ink">{p.project.title}</h3>
        {latest?.changeNote ? (
          <Alert tone="warning" title={p.project.changesTitle}>
            {latest.changeNote}
          </Alert>
        ) : (
          <p className="text-base text-ink-soft">{lead}</p>
        )}
        <ProjectForm offerId={offer.id} initial={initial} isNewVersion={latest !== undefined} />
      </div>
    );
  }
  const approved = latest.status === "APPROVED";
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-bold text-ink">{p.project.title}</h3>
      <Alert tone={approved ? "success" : "info"} title={approved ? p.project.approvedTitle : p.project.sentTitle}>
        {approved ? (afterContract ? p.project.approvedTextAfterContract : p.project.approvedTextExecutor) : p.project.sentText}
      </Alert>
      <ProjectView project={latest} />
    </div>
  );
}
