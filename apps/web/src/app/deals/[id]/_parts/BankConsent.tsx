"use client";

import { useState } from "react";
import { ConsentText } from "@/app/_components/consent/ConsentText";
import { ru } from "@/i18n/ru";
import { Checkbox, FormError } from "@/ui";
import { useRunAction } from "../../_parts/useRunAction";
import { bankConsentAction } from "../actions";

const t = ru.consent.bank;

/**
 * Отметка «Передача данных банку-партнёру» (A.2, P3) в «Что дальше»: мастер — до подписи оферты, покупатель — перед
 * оплатой. Отметка сразу сохраняется (identity, к этой сделке) и обновляет экран: открываются подпись или оплата. Снять
 * отметку нельзя — согласие к сделке не отзывается, пока она исполняется (текст согласия, раздел 4).
 */
export function BankConsentBox({ dealId, side }: { dealId: string; side: "CLIENT" | "EXECUTOR" }) {
  const { run, pending, error } = useRunAction(bankConsentAction);
  // Ошибка — отметка остаётся, повтор — снять и поставить снова.
  const [checked, setChecked] = useState(false);
  return (
    <section aria-labelledby="bank-consent-title" className="flex flex-col gap-3 rounded-control border border-line p-4">
      <h3 id="bank-consent-title" className="text-lg font-bold text-ink">
        {t.title}
      </h3>
      <Checkbox
        label={t.label}
        hint={side === "CLIENT" ? t.hintClient : t.hintExecutor}
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          setChecked(e.target.checked);
          if (e.target.checked) run({ dealId });
        }}
      />
      <FormError message={error} />
      <details className="rounded-control border border-line">
        <summary className="flex min-h-control cursor-pointer items-center px-4 text-base font-semibold text-ink">{t.readText}</summary>
        <div className="px-4 pb-4">
          <ConsentText document={ru.consent.documents.BANK_TRANSFER} headingLevel="h4" />
        </div>
      </details>
    </section>
  );
}
