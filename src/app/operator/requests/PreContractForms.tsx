"use client";

import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { allowOfferRetrySchema } from "@/modules/requests/client";
import { Alert, Button, FormError, Input, Select } from "@/ui";
import { useRunAction } from "@/app/requests/_parts/ActionButton";
import { allowOfferRetryAction, assignSiteMeasurerAction } from "@/app/_components/pre-contract/actions";

const t = ru.requests.pre.operator;

/** Назначение замерщика площадки на заявку (сценарий 2). */
export function AssignMeasurerForm({ requestId, measurers }: { requestId: string; measurers: { id: string; name: string }[] }) {
  const [measurerId, setMeasurerId] = useState(measurers[0]?.id ?? "");
  const { run, pending, error } = useRunAction(assignSiteMeasurerAction);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run({ requestId, measurerId });
  };
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Select
        label={t.measurer}
        placeholder={false}
        value={measurerId}
        onChange={(e) => setMeasurerId(e.target.value)}
        options={measurers.map((m) => ({ value: m.id, label: m.name }))}
        className="sm:w-72"
      />
      <Button type="submit" loading={pending}>
        {t.assign}
      </Button>
      <FormError message={error} />
    </form>
  );
}

/** Повторный отклик (№16): причина обязательна, попадает в журнал аудита. */
export function AllowRetryForm({ requestId, executorId }: { requestId: string; executorId: string }) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [done, setDone] = useState(false);
  const { run, pending, error } = useRunAction(allowOfferRetryAction);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = allowOfferRetrySchema.safeParse({ requestId, executorId, reason });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setDone((await run(parsed.data)).ok);
  };
  if (done) {
    return (
      <Alert tone="success" live="polite">
        {t.retryDone}
      </Alert>
    );
  }
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
      <Input label={t.retryReason} hint={t.retryReasonHint} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={fieldError} />
      <Button type="submit" variant="secondary" loading={pending} className="self-start">
        {t.retry}
      </Button>
      <FormError message={error} />
    </form>
  );
}
