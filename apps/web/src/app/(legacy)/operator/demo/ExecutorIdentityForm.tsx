"use client";

import { ru } from "@/i18n/ru";
import type { ExecutorIdentityMode } from "@/modules/companies";
import { Button, RadioCards } from "@/ui";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { setExecutorIdentityAction } from "./identity-actions";

const t = ru.companies.identity;
const MODES = ["HIDDEN", "SHOWN"] as const satisfies readonly ExecutorIdentityMode[];

export function ExecutorIdentityForm({ current }: { current: ExecutorIdentityMode }) {
  const form = useActionForm(setExecutorIdentityAction);
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <RadioCards
        label={t.settingTitle}
        hint={t.settingHint}
        name="mode"
        defaultValue={current}
        options={MODES.map((m) => ({ value: m, label: t.modes[m], description: t.modeHints[m] }))}
        columns={2}
        error={form.fieldError("mode")}
      />
      <FormStatus error={form.error} done={form.done} doneText={t.saved} />
      <Button type="submit" loading={form.pending} className="self-start">
        {t.save}
      </Button>
    </form>
  );
}
