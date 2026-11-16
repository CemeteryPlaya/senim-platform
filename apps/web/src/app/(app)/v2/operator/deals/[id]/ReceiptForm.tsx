"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Button, HiddenField, Stack, toast } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { createReleaseReceiptAction } from "./actions";

const r = ru.app.operatorDeals.release;

/**
 * «Сформировать расписку»: documents выпускает PDF по суммам раскрытия в журнале. После выпуска экран обновляется — на месте
 * формы ссылка на PDF. Расписка не главное действие экрана — кнопка второстепенная. Двойное нажатие гасит форма.
 */
export function ReceiptForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const form = useActionForm(createReleaseReceiptAction, {
    onSuccess: () => {
      toast(r.receiptCreated);
      router.refresh();
    },
  });
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack gap="tight">
        <HiddenField name="dealId" value={dealId} />
        <FormError error={form.error} />
        <Button type="submit" variant="secondary" pending={form.pending}>
          {r.createReceipt}
        </Button>
      </Stack>
    </form>
  );
}
