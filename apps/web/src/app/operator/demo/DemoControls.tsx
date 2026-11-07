"use client";

import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Modal } from "@/ui";
import { resetDemoAction } from "./actions";

const t = ru.operator.demo;
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
