"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, focusFirstInvalid, Input, RadioCards } from "@/ui";
import { DEFAULT_STAGE_TEMPLATE, STAGE_TEMPLATES, type StageTemplateKey } from "@/verticals/furniture";
import { agreeToContractAction } from "../actions";
import { FormError, useRunAction } from "../_parts/ActionButton";

const t = ru.requests.request;
const ci = ru.identity.clientIdentity;
const KEYS = Object.keys(STAGE_TEMPLATES) as StageTemplateKey[];

/**
 * Согласие с итоговой ценой: заказчик выбирает порядок оплаты, сделку создаёт deal-core.
 * needsIdentity — у заказчика ещё нет ФИО и ИИН (вход по SMS): они нужны в договоре, спрашиваем здесь один раз.
 */
export function AgreeForm({ requestId, needsIdentity }: { requestId: string; needsIdentity: boolean }) {
  const [template, setTemplate] = useState<StageTemplateKey>(DEFAULT_STAGE_TEMPLATE);
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
        void run({ requestId, template, identity });
      }}
    >
      <RadioCards
        label={t.templateLabel}
        hint={t.templateHint}
        name="template"
        value={template}
        onChange={(v) => setTemplate(KEYS.find((k) => k === v) ?? DEFAULT_STAGE_TEMPLATE)}
        options={KEYS.map((k) => ({ value: k, label: STAGE_TEMPLATES[k].name, description: STAGE_TEMPLATES[k].description }))}
      />
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
      <Button type="submit" loading={pending} iconEnd={<ArrowRight />}>
        {t.agree}
      </Button>
      <FormError message={error} />
    </form>
  );
}
