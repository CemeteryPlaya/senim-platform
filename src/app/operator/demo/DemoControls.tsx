"use client";

import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Modal, RadioCards } from "@/ui";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { resetDemoAction, setPaymentRailAction } from "./actions";

const t = ru.operator.demo;
const MODES = ["manual", "escrow-simulator"] as const;

export function RailForm({ current }: { current: (typeof MODES)[number] }) {
  const form = useActionForm(setPaymentRailAction);
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <RadioCards
        label={t.railTitle}
        hint={t.railHint}
        name="mode"
        defaultValue={current}
        options={MODES.map((m) => ({ value: m, label: t.railModes[m], description: t.railModeHints[m] }))}
        columns={2}
        error={form.fieldError("mode")}
      />
      <FormStatus error={form.error} done={form.done} doneText={t.railSaved} />
      <Button type="submit" loading={form.pending} className="self-start">
        {t.railSave}
      </Button>
    </form>
  );
}

/**
 * «Сбросить демо» с подтверждением. После сброса сессии очищены — сервер удаляет cookie
 * и переводит на выбор демо-персоны (/demo); модалка предупреждает об этом.
 */
export function ResetDemo() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const result = await resetDemoAction({});
      if (!result.ok) setError(result.error);
    });

  return (
    <>
      <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>
        {t.reset}
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={t.confirmTitle}
        description={t.confirmText}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {ru.common.actions.cancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={confirm}>
              {t.confirm}
            </Button>
          </>
        }
      >
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
      </Modal>
    </>
  );
}
