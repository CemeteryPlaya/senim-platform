"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, focusFirstInvalid, Input } from "@/ui";
import { agreeToContractAction } from "../actions";
import { FormError, useRunAction } from "../_parts/ActionButton";

const t = ru.requests.request;
const ci = ru.identity.clientIdentity;

/**
 * Сценарий до договора (флаг preContractFlows): согласие с итоговой ценой, сделку с офертой создаёт deal-core.
 * Оплата одна — в начале, деньги в банке под защитой до подписи акта (ADR-009).
 * needsIdentity — у заказчика ещё нет ФИО и ИИН (вход по SMS): они нужны в оферте, спрашиваем здесь один раз.
 */
export function AgreeForm({ requestId, needsIdentity }: { requestId: string; needsIdentity: boolean }) {
  const [fullName, setFullName] = useState("");
  const [iin, setIin] = useState("");
  const { run, pending, error, fieldErrors } = useRunAction(agreeToContractAction, (d) => `/deals/${d.dealId}`);
  const identity = needsIdentity ? { fullName, iin: iin.replace(/\s/g, "") } : undefined;
  const form = useRef<HTMLFormElement>(null);

  // После отказа сервера — фокус на первое поле с ошибкой (поля уже получили aria-invalid).
  useEffect(() => {
    if (fieldErrors && form.current) focusFirstInvalid(form.current);
  }, [fieldErrors]);

  return (
    // Форма: Enter в поле ФИО или ИИН отправляет согласие так же, как кнопка.
    <form
      ref={form}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run({ requestId, identity });
      }}
    >
      <p className="flex items-start gap-2 text-lg font-bold text-ink">
        <ShieldCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
        {t.paymentTz}
      </p>
      {needsIdentity && (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-bold text-ink">{ci.title}</legend>
          <p className="text-base text-ink-soft">{ci.lead}</p>
          <Input
            label={ci.fullName}
            hint={ci.fullNameHint}
            name="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={fieldErrors?.fullName?.[0]}
          />
          <Input
            label={ci.iin}
            hint={ci.iinHint}
            name="iin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={15}
            value={iin}
            onChange={(e) => setIin(e.target.value)}
            error={fieldErrors?.iin?.[0]}
          />
        </fieldset>
      )}
      <Button type="submit" loading={pending} iconEnd={<ArrowRight />} className="sm:self-start">
        {t.agree}
      </Button>
      <FormError message={error} />
    </form>
  );
}
