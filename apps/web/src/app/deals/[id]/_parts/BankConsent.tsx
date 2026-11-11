"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConsentText } from "@/app/_components/consent/ConsentText";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Checkbox, FormError } from "@/ui";
import { bankConsentAction } from "../actions";

const t = ru.consent.bank;

/**
 * Отметка «Передача данных банку-партнёру» (A.2, P3) в «Что дальше»: мастер — до подписи оферты, покупатель — перед
 * оплатой. Отметка сразу сохраняется (identity, к этой сделке) и обновляет экран: открываются подпись или оплата. Снять
 * отметку нельзя — согласие к сделке не отзывается, пока она исполняется (текст согласия, раздел 4). Сервер получает
 * редакцию показанного текста (`document` — с сервера): сменилась — ошибка «текст обновился», отметка снимается, экран
 * перерисовывается с новой редакцией.
 */
export function BankConsentBox({ dealId, side, document: doc }: { dealId: string; side: "CLIENT" | "EXECUTOR"; document: ConsentDocument }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  function give() {
    setError(null);
    startTransition(async () => {
      const res = await bankConsentAction({ dealId, version: doc.version });
      if (res.ok) return router.refresh();
      if (leaveIfSignedOut(res)) return;
      setChecked(false);
      setError(res.error);
      if (res.code === "CONFLICT") router.refresh();
    });
  }

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
          if (e.target.checked) give();
        }}
      />
      <FormError message={error} />
      <details className="rounded-control border border-line">
        <summary className="flex min-h-control cursor-pointer items-center px-4 text-base font-semibold text-ink">{t.readText}</summary>
        <div className="px-4 pb-4">
          <ConsentText document={doc} headingLevel="h4" />
        </div>
      </details>
    </section>
  );
}
