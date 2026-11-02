"use client";

import { useState, type FormEvent } from "react";
import { useRunAction } from "@/app/deals/_parts/useRunAction";
import { ru } from "@/i18n/ru";
import { Button, Checkbox, FormError } from "@/ui";
import { setPortfolioConsentAction } from "./actions";

const t = ru.companies.dealPortfolio.panel;

/**
 * Галочка заказчика «Разрешаю показать фото…» и «Сохранить». Повтор того же состояния ничего не меняет
 * (сервер сравнивает с ожидаемым), отзыв скрывает работу сразу.
 */
export function ConsentForm({ dealId, consent }: { dealId: string; consent: boolean }) {
  const [checked, setChecked] = useState(consent);
  const { run, pending, error } = useRunAction(setPortfolioConsentAction);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ dealId, consent: checked });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-base text-ink" aria-live="polite">
        {consent ? t.consentGiven : t.consentNotGiven}
      </p>
      <Checkbox label={t.consentLabel} checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      <FormError message={error} />
      <Button type="submit" variant={checked === consent ? "secondary" : "primary"} loading={pending}>
        {consent && !checked ? t.revoke : t.save}
      </Button>
    </form>
  );
}
