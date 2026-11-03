"use client";

import { ru } from "@/i18n/ru";
import { Button } from "@/ui";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { retryBankOperationAction } from "./actions";

const t = ru.operator.money;

/**
 * «Повторить операцию» у отклонённой банком операции: новая попытка с новым ключом.
 * Пока запрос идёт, кнопка заблокирована; повтор всё равно не создаст второй попытки (payments).
 */
export function RetryOperationForm({ transactionId }: { transactionId: string }) {
  const form = useActionForm(retryBankOperationAction);
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="transactionId" value={transactionId} />
      <FormStatus error={form.error} done={form.done} doneText={t.retried} />
      <Button type="submit" variant="secondary" loading={form.pending} className="self-start">
        {t.retry}
      </Button>
    </form>
  );
}
