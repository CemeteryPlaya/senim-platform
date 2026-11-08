"use client";

import { ru } from "@/i18n/ru";
import type { ManualOperationType } from "@/modules/operator";
import { Button, Input, Textarea } from "@/ui";
import { useQueueDecision } from "../_components/DecisionQueue";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { confirmBankOperationAction, failBankOperationAction } from "./actions";

const t = ru.operator.money;

/** Сегодня по Астане в формате поля даты: по умолчанию документ банка сегодняшний. */
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(new Date());

/**
 * Подтверждение операции по банковскому документу: номер, дата, скан — и одна кнопка с тем, что сделал банк.
 * Пока запрос идёт, кнопка заблокирована; повтор всё равно не создаст второго подтверждения (payments).
 */
export function ConfirmOperationForm({ transactionId, type, primary }: { transactionId: string; type: ManualOperationType; primary: boolean }) {
  // В очереди карточка после решения исчезает: итог объявляет очередь, а не форма.
  const decided = useQueueDecision();
  const form = useActionForm(confirmBankOperationAction, { reset: true, onSuccess: (_, el) => decided?.(t.confirmed, el) });
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="transactionId" value={transactionId} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
        <Input label={t.bankDocNumber} name="bankDocNumber" required maxLength={100} autoComplete="off" error={form.fieldError("bankDocNumber")} />
        <Input label={t.bankDocDate} name="bankDocDate" type="date" required defaultValue={today()} max={today()} error={form.fieldError("bankDocDate")} />
      </div>
      <Input
        label={t.scan}
        hint={t.scanHint}
        name="scan"
        type="file"
        required
        accept="application/pdf,image/jpeg,image/png"
        error={form.fieldError("scan") ?? form.fieldError("bankDocFileId")}
      />
      <FormStatus error={form.error} done={form.done && !decided} doneText={t.confirmed} />
      <Button type="submit" variant={primary ? "primary" : "secondary"} loading={form.pending} className="self-start">
        {t.confirm[type]}
      </Button>
    </form>
  );
}

/** «Отклонено банком»: причина обязательна, её увидят стороны сделки. */
export function FailOperationForm({ transactionId }: { transactionId: string }) {
  const decided = useQueueDecision();
  const form = useActionForm(failBankOperationAction, { onSuccess: (_, el) => decided?.(t.failed, el) });
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="transactionId" value={transactionId} />
      <Textarea label={t.failReason} hint={t.failReasonHint} name="reason" required maxLength={500} rows={3} error={form.fieldError("reason")} />
      <FormStatus error={form.error} done={form.done && !decided} doneText={t.failed} />
      <Button type="submit" variant="secondary" loading={form.pending} className="self-start">
        {t.failSubmit}
      </Button>
    </form>
  );
}

/**
 * Карточка ждущей операции: подтверждение по документу и, свёрнуто, отказ банка. primary — заливная кнопка
 * подтверждения: только на карточке сделки у первой ждущей операции (у одной сделки операции идут по порядку);
 * в общей очереди «Деньги в банке» карточки равноправны — везде обводка.
 */
export function OperationActions({ transactionId, type, primary }: { transactionId: string; type: ManualOperationType; primary: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <ConfirmOperationForm transactionId={transactionId} type={type} primary={primary} />
      <details className="group rounded-control border border-line p-4">
        <summary className="min-h-control cursor-pointer content-center text-base font-semibold text-ink">{t.failTitle}</summary>
        <div className="pt-4">
          <FailOperationForm transactionId={transactionId} />
        </div>
      </details>
    </div>
  );
}
