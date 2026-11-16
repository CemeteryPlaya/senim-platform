"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card, CodeField, EmailField, IbanField, IinField, InstagramField, Money, MoneyField, PhoneField, Stack } from "@/kit";
import { computeDealMoney, MAX_PRICE_TIYN } from "@/modules/payments/client";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { codeSampleAction, maskSampleAction } from "./form-sample-actions";

const t = ru.app.kit.showcase.masks;

/** «Вы получите» под ценой — та же формула, что у сделки (`computeDealMoney`); вне границ цены — ничего. */
function YouGet({ tiyn }: { tiyn: bigint | null }) {
  if (tiyn === null || tiyn <= 0n || tiyn > MAX_PRICE_TIYN) return null;
  return (
    <p className="flex items-baseline justify-between gap-4 text-body text-ink" aria-live="polite">
      <span>{t.youGet}</span>
      <Money tiyn={computeDealMoney(tiyn).payoutTiyn} />
    </p>
  );
}

/**
 * Образцы полей с маской витрины: телефон, сумма с расчётом под полем, ИИН и БИН, IBAN, почта с подсказкой опечатки,
 * Instagram — в одной форме на `useActionForm` (ответ показывает, что дошло до сервера); код с автоотправкой — своей формой.
 */
export function MaskSamples() {
  const form = useActionForm(maskSampleAction);
  const code = useActionForm(codeSampleAction);
  const [price, setPrice] = useState<bigint | null>(null);
  return (
    <div className="grid grid-cols-1 items-start gap-stack-group desktop:grid-cols-2">
      <Card>
        <form onSubmit={form.onSubmit} noValidate>
          <Stack>
            <p className="text-sub text-muted">{t.note}</p>
            <PhoneField label={t.phone} name="phone" error={form.fieldErrors.phone} />
            <MoneyField label={t.price} name="price" onValueChange={setPrice} under={<YouGet tiyn={price} />} error={form.fieldErrors.price} />
            <IinField label={t.iin} name="iin" error={form.fieldErrors.iin} />
            <IinField label={t.bin} name="bin" kind="bin" error={form.fieldErrors.bin} />
            <IbanField label={t.iban} name="iban" error={form.fieldErrors.iban} />
            <EmailField label={t.email} name="email" error={form.fieldErrors.email} />
            <InstagramField label={t.instagram} name="instagram" error={form.fieldErrors.instagram} />
            <FormError error={form.error} />
            <Button type="submit" variant="secondary" pending={form.pending}>
              {t.submit}
            </Button>
          </Stack>
        </form>
      </Card>
      <Card>
        <form onSubmit={code.onSubmit} noValidate>
          <Stack>
            <p className="text-sub text-muted">{t.codeNote}</p>
            <CodeField label={t.code} name="code" error={code.fieldErrors.code} autoSubmit />
            <Button type="submit" variant="secondary" pending={code.pending}>
              {t.submit}
            </Button>
          </Stack>
        </form>
      </Card>
    </div>
  );
}
