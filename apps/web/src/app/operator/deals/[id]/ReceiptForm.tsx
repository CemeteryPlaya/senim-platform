"use client";

import { createReleaseReceiptAction } from "@/app/_components/signing/actions";
import { ru } from "@/i18n/ru";
import { Button } from "@/ui";
import { FormStatus } from "../../_components/FormStatus";
import { useActionForm } from "../../_components/useActionForm";

const r = ru.operator.deals.release;

/** «Сформировать расписку»: documents выпускает PDF RELEASE_RECEIPT по суммам раскрытия в журнале. */
export function ReceiptForm({ dealId }: { dealId: string }) {
  const form = useActionForm(() => createReleaseReceiptAction({ dealId }));
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-3">
      <FormStatus error={form.error} done={form.done} doneText={r.receiptCreated} />
      <Button type="submit" variant="secondary" loading={form.pending} className="self-start">
        {r.createReceipt}
      </Button>
    </form>
  );
}
