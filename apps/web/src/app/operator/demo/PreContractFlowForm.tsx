"use client";

import { useState, type FormEvent } from "react";
import type { PreContractFlow } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { PRE_CONTRACT_FLOWS } from "@/modules/requests/client";
import { Alert, Button, FormError, RadioCards } from "@/ui";
import { useRunAction } from "@/app/requests/_parts/ActionButton";
import { setPreContractFlowAction } from "@/app/_components/pre-contract/actions";

const t = ru.requests.pre;

/** Переключатель «Сценарий до договора»: пять вариантов с короткой подписью, действует для новых заявок. */
export function PreContractFlowForm({ current }: { current: PreContractFlow }) {
  const [flow, setFlow] = useState<PreContractFlow>(current);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useRunAction(setPreContractFlowAction);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const result = await run({ flow });
    setSaved(result.ok);
  };

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <RadioCards
        label={t.setting.title}
        hint={t.setting.hint}
        name="preContractFlow"
        value={flow}
        onChange={(v) => setFlow(PRE_CONTRACT_FLOWS.find((f) => f === v) ?? current)}
        options={PRE_CONTRACT_FLOWS.map((f, i) => ({ value: f, label: t.setting.option(i + 1, t.flowNames[f]), description: t.flowHints[f] }))}
      />
      {saved && (
        <Alert tone="success" live="polite">
          {t.setting.saved}
        </Alert>
      )}
      <Button type="submit" loading={pending} className="self-start">
        {t.setting.save}
      </Button>
      <FormError message={error} />
    </form>
  );
}
