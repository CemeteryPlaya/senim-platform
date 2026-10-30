"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Button, Input, Select } from "@/ui";
import { FormStatus } from "../../_components/FormStatus";
import { useActionForm } from "../../_components/useActionForm";
import { addExecutorAction } from "../actions";

const t = ru.operator;
const f = t.executors.form;

export function AddExecutorForm() {
  const router = useRouter();
  const form = useActionForm(addExecutorAction, { onSuccess: ({ profileId }) => router.push(`/operator/executors/${profileId}`) });

  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-5">
      <Input label={f.phone} hint={f.phoneHint} name="phone" type="tel" inputMode="tel" autoComplete="off" required error={form.fieldError("phone")} />
      <Select
        label={f.legalForm}
        name="legalForm"
        required
        defaultValue="SELF_EMPLOYED"
        options={(["SELF_EMPLOYED", "IP", "TOO"] as const).map((v) => ({ value: v, label: t.legalForms[v] }))}
        error={form.fieldError("legalForm")}
      />
      <Input label={f.legalName} hint={f.legalNameHint} name="legalName" required error={form.fieldError("legalName")} />
      <Input label={f.binIin} hint={f.binIinHint} name="binIin" inputMode="numeric" autoComplete="off" required error={form.fieldError("binIin")} />
      <Select
        label={f.segment}
        name="segment"
        required
        defaultValue="COMFORT"
        options={(["ECONOMY", "COMFORT", "PREMIUM"] as const).map((v) => ({ value: v, label: t.segments[v] }))}
        error={form.fieldError("segment")}
      />
      <FormStatus error={form.error} />
      <Button type="submit" loading={form.pending} fullWidth>
        {f.submit}
      </Button>
    </form>
  );
}
