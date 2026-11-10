"use client";

import { useState, useTransition } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, Modal, Textarea } from "@/ui";
import { closeChatAction, reopenChatAction } from "./actions";

const m = ru.companies.chat.moderation;

type Props = { offerId: string; closed: boolean; reasonMax: number; onChanged: () => Promise<void> };

/**
 * Управление чатом для оператора (ответ №19): «Закрыть чат» с причиной или «Открыть чат снова».
 * Повторное нажатие не даёт второго эффекта: кнопка занята, пока идёт запрос, а сервер переводит
 * состояние условным updateMany (второй запрос — «Чат уже закрыт/открыт»).
 */
export function ChatModeration(props: Props) {
  return props.closed ? <Reopen {...props} /> : <Close {...props} />;
}

function Close({ offerId, reasonMax, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await closeChatAction({ offerId, reason });
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      await onChanged();
    });

  return (
    <>
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {m.close}
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={m.closeTitle}
        description={m.closeText}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {ru.common.actions.cancel}
            </Button>
            <Button variant="danger" loading={pending} onClick={submit}>
              {m.confirmClose}
            </Button>
          </>
        }
      >
        <Textarea
          label={m.reasonLabel}
          hint={m.reasonHint}
          name="reason"
          value={reason}
          maxLength={reasonMax}
          onChange={(e) => setReason(e.target.value)}
          error={error}
          required
        />
      </Modal>
    </>
  );
}

function Reopen({ offerId, onChanged }: Props) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const reopen = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await reopenChatAction({ offerId });
      if (!result.ok && !leaveIfSignedOut(result)) setError(result.error);
      await onChanged();
    });

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="self-start" loading={pending} onClick={reopen}>
        {m.reopen}
      </Button>
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
