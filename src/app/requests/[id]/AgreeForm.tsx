"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, RadioCards } from "@/ui";
import { DEFAULT_STAGE_TEMPLATE, STAGE_TEMPLATES, type StageTemplateKey } from "@/verticals/furniture";
import { agreeToContractAction } from "../actions";
import { FormError, useRunAction } from "../_parts/ActionButton";

const t = ru.requests.request;
const KEYS = Object.keys(STAGE_TEMPLATES) as StageTemplateKey[];

/** Согласие с итоговой ценой: заказчик выбирает порядок оплаты, сделку создаёт deal-core. */
export function AgreeForm({ requestId }: { requestId: string }) {
  const [template, setTemplate] = useState<StageTemplateKey>(DEFAULT_STAGE_TEMPLATE);
  const { run, pending, error } = useRunAction(agreeToContractAction, (d) => `/deals/${d.dealId}`);
  return (
    <div className="flex flex-col gap-4">
      <RadioCards
        label={t.templateLabel}
        hint={t.templateHint}
        name="template"
        value={template}
        onChange={(v) => setTemplate(KEYS.find((k) => k === v) ?? DEFAULT_STAGE_TEMPLATE)}
        options={KEYS.map((k) => ({ value: k, label: STAGE_TEMPLATES[k].name, description: STAGE_TEMPLATES[k].description }))}
      />
      <Button loading={pending} iconEnd={<ArrowRight />} onClick={() => void run({ requestId, template })}>
        {t.agree}
      </Button>
      <FormError message={error} />
    </div>
  );
}
