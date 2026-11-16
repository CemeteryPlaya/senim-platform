"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { PreContractFlow } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { Button, Card, RadioCard, RadioGroup, Stack, toast } from "@/kit";
import type { ExecutorIdentityMode } from "@/modules/companies";
import { PRE_CONTRACT_FLOWS } from "@/modules/requests/client";
import { FormError } from "../../../_shell/FormError";
import { useOperatorForm } from "../_parts/form";
import { SecondFactorField } from "../_parts/SecondFactorField";
import { setExecutorIdentityAction, setPreContractFlowAction } from "./actions";

const t = ru.app.operatorSettings.settings;
const MODES = ["HIDDEN", "SHOWN"] as const satisfies readonly ExecutorIdentityMode[];

/**
 * «Как заказчик видит исполнителя» (ADR-006): два режима карточками. Сохранение — со свежим кодом из приложения: если его
 * вводили давно, над кнопкой появится поле кода, и форма повторит сохранение. Главная кнопка экрана.
 */
export function ExecutorIdentityForm({ current }: { current: ExecutorIdentityMode }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useOperatorForm(setExecutorIdentityAction, {
    formRef,
    onSuccess: () => {
      toast(t.identity.saved);
      router.refresh();
    },
  });
  return (
    <Card>
      <form ref={formRef} onSubmit={form.onSubmit} noValidate>
        <Stack>
          <RadioGroup legend={t.identity.title} {...(form.fieldErrors.mode ? { error: form.fieldErrors.mode } : {})}>
            {MODES.map((mode) => (
              <RadioCard key={mode} name="mode" value={mode} label={t.identity.modes[mode]} description={t.identity.modeHints[mode]} defaultChecked={mode === current} />
            ))}
          </RadioGroup>
          <p className="text-sub text-muted">{t.identity.hint}</p>
          <FormError error={form.error} atField={Boolean(form.fieldErrors.mode)} />
          <SecondFactorField form={form} />
          <Button type="submit" pending={form.pending}>
            {t.identity.save}
          </Button>
        </Stack>
      </form>
    </Card>
  );
}

/**
 * «Сценарий до договора» для новых заявок (ADR-005): пять вариантов с короткой подписью. Свежий код — как у режима имени.
 * Кнопка второстепенная: главная на экране одна — сохранение режима имени.
 */
export function PreContractFlowForm({ current }: { current: PreContractFlow }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useOperatorForm(setPreContractFlowAction, {
    formRef,
    onSuccess: () => {
      toast(t.flow.saved);
      router.refresh();
    },
  });
  return (
    <Card>
      <form ref={formRef} onSubmit={form.onSubmit} noValidate>
        <Stack>
          <RadioGroup legend={t.flow.title} {...(form.fieldErrors.flow ? { error: form.fieldErrors.flow } : {})}>
            {PRE_CONTRACT_FLOWS.map((flow, index) => (
              <RadioCard key={flow} name="flow" value={flow} label={t.flow.option(index + 1, t.flow.names[flow])} description={t.flow.hints[flow]} defaultChecked={flow === current} />
            ))}
          </RadioGroup>
          <p className="text-sub text-muted">{t.flow.hint}</p>
          <FormError error={form.error} atField={Boolean(form.fieldErrors.flow)} />
          <SecondFactorField form={form} />
          <Button type="submit" variant="secondary" pending={form.pending}>
            {t.flow.save}
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
