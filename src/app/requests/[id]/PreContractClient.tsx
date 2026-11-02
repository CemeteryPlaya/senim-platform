import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import type { PreContractView } from "@/modules/requests";
import { MapPin } from "lucide-react";
import { Alert, formatMoney } from "@/ui";
import { CostSummary } from "@/app/_components/pre-contract/CostSummary";
import { ActionButton } from "../_parts/ActionButton";
import { markDepositPaidAction } from "@/app/_components/pre-contract/actions";
import { ProjectDecision } from "@/app/_components/pre-contract/ProjectDecision";
import { ProjectView } from "@/app/_components/pre-contract/ProjectView";

/** Шаги до договора на экране заказчика (ADR-005): замер площадки, залог, проект, условия договора по сценарию. */

const p = ru.requests.pre;
type Pre = PreContractView;

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 sm:p-6">
      <h2 id={id} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Сценарий 2: заявка ждёт замерщика площадки. */
export function SiteWait({ pre }: { pre: Pre }) {
  return (
    <Alert tone="accent" title={p.site.clientWaitTitle}>
      {pre.site ? p.site.clientAssigned : p.site.clientWaitText}
    </Alert>
  );
}

/** Сценарий 4: залог за выезд — напрямую исполнителю; площадка только фиксирует отметки. */
export function DepositClient({ pre, offerId }: { pre: Pre; offerId: string }) {
  const amount = formatMoney(pre.deposit?.amount ?? pre.depositAmount);
  if (pre.deposit?.status === "MARKED_PAID") return <Alert tone="info" title={p.deposit.title}>{p.deposit.markedClient}</Alert>;
  return (
    <Panel id="deposit" title={p.deposit.title}>
      <p className="text-base text-ink">{p.deposit.clientText(amount)}</p>
      <div className="self-start">
        <ActionButton
          action={markDepositPaidAction}
          input={{ offerId }}
          confirm={{ title: p.deposit.markConfirmTitle, text: p.deposit.markConfirmText, yes: p.deposit.markConfirm, no: ru.common.actions.cancel, tone: "primary" }}
        >
          {p.deposit.mark}
        </ActionButton>
      </div>
    </Panel>
  );
}

/** Проект: ждём исполнителя, решение по версии, ждём новую версию или утверждён. */
export function ClientProject({ pre, children }: { pre: Pre; children?: ReactNode }) {
  const afterContract = !pre.rules.projectBeforeContract;
  const latest = pre.projects[0];
  const tolerance = afterContract && pre.tolerance && (
    <p className="text-base text-ink-soft">{p.project.toleranceRule(formatMoney(pre.tolerance.min), formatMoney(pre.tolerance.max))}</p>
  );
  if (!latest) {
    return (
      <Panel id="project" title={p.project.title}>
        <Alert tone="info" title={p.project.waitTitle}>
          {p.project.waitText}
        </Alert>
        {tolerance}
        {children}
      </Panel>
    );
  }
  return (
    <Panel id="project" title={p.project.title}>
      {latest.status === "SUBMITTED" && <p className="text-base text-ink">{afterContract ? p.project.clientLeadAfterContract : p.project.clientLead}</p>}
      {tolerance}
      <ProjectView project={latest} />
      {latest.status === "SUBMITTED" && <ProjectDecision projectId={latest.id} afterContract={afterContract} />}
      {latest.status === "CHANGES_REQUESTED" && <Alert tone="info">{p.project.waitText}</Alert>}
      {latest.status === "APPROVED" && afterContract && <Alert tone="success">{p.project.approvedTextAfterContract}</Alert>}
      {children}
    </Panel>
  );
}

/** Что сказать о договоре по сценарию: для «договора до замера» — цена с допуском. */
export function ContractTerms({ pre }: { pre: Pre }) {
  return (
    <>
      {pre.tolerance && !pre.rules.projectBeforeContract && (
        <Alert tone="accent" title={p.agree.contractFirstTitle}>
          {p.agree.contractFirstText(formatMoney(pre.tolerance.price), formatMoney(pre.tolerance.min), formatMoney(pre.tolerance.max))}
        </Alert>
      )}
    </>
  );
}

/**
 * Итоговая стоимость перед договором (макет 9, экран 1): по утверждённому проекту — расшифровка, срок и гарантия,
 * иначе — одна цена (замера или предложения с допуском). Адрес монтажа — свой, его видит только выбранный исполнитель.
 */
export function ContractSummary({ pre, price, priceLabel, address }: { pre: Pre; price: number; priceLabel: string; address: string | null }) {
  const project = pre.approvedProject;
  return (
    <div className="flex flex-col gap-4">
      {project ? (
        <CostSummary lines={project.costLines} total={project.totalPrice} totalLabel={p.agree.projectPrice} durationDays={project.durationDays} warrantyMonths={project.warrantyMonths} />
      ) : (
        <CostSummary total={price} totalLabel={priceLabel} />
      )}
      {address && (
        <p className="flex items-start gap-3 text-base">
          <MapPin aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-muted">{p.agree.address}</span>
            <span className="text-ink">{address}</span>
          </span>
        </p>
      )}
    </div>
  );
}
