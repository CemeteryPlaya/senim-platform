"use client";

import type { PreContractFlow } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { PRE_CONTRACT_FLOWS } from "@/modules/requests/client";
import { Button, RadioCards } from "@/ui";
import { FormStatus } from "../_components/FormStatus";
import { SecondFactorField } from "../_components/SecondFactorField";
import { useActionForm } from "../_components/useActionForm";
import { setPreContractFlowAction } from "./actions";

const t = ru.requests.pre;

/**
 * Переключатель «Сценарий до договора»: пять вариантов с короткой подписью, действует для новых заявок. Без свежего кода
 * из приложения форма спросит его (SecondFactorField) и повторит сохранение.
 */
export function PreContractFlowForm({ current }: { current: PreContractFlow }) {
  const form = useActionForm(setPreContractFlowAction);
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <RadioCards
        label={t.setting.title}
        hint={t.setting.hint}
        name="flow"
        defaultValue={current}
        options={PRE_CONTRACT_FLOWS.map((f, i) => ({ value: f, label: t.setting.option(i + 1, t.flowNames[f]), description: t.flowHints[f] }))}
        error={form.fieldError("flow")}
      />
      <FormStatus error={form.error} done={form.done} doneText={t.setting.saved} />
      <SecondFactorField form={form} />
      {/* Обводка: на экране настроек заливная кнопка одна — сохранение режима имени исполнителя. */}
      <Button type="submit" variant="secondary" loading={form.pending} className="self-start">
        {t.setting.save}
      </Button>
    </form>
  );
}
