"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Button, Dialog, RadioCard, RadioGroup, Sheet, Stack, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { useClientKey } from "../../../../_shell/client-key";
import { useSettle } from "../../../../_shell/settle";
import { inviteExecutorAction } from "../actions";
import type { InviteView } from "./invite";

const t = ru.app.guest.executor.invite;

/**
 * Отправка приглашения: одна за раз (повторное нажатие, пока идёт запрос, игнорируется); повтор после сбоя — с тем же
 * ключом, поэтому приглашение одно. Успех (в том числе повтор — `created: false`) — тот же тост и обновлённый экран с
 * «Приглашение отправлено». Отказ — тост с текстом сервера (`useSettle`). Возвращает, прошло ли приглашение.
 */
function useInvite(publicNumber: number) {
  const router = useRouter();
  const settle = useSettle();
  const retry = useClientKey();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  async function send(requestId: string): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    try {
      const sent = { requestId, publicNumber };
      const result = await inviteExecutorAction({ ...sent, clientKey: retry.keyFor(sent) });
      let ok = false;
      settle(result, () => {
        ok = true;
        retry.done();
        toast(t.toast);
        router.refresh();
      });
      return ok;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { send, pending };
}

type ContextView = Extract<InviteView, { kind: "context" }>;
type PickView = Extract<InviteView, { kind: "pick" }>;

/** Заказ известен — одна кнопка «Пригласить к заказу №N»: нажатие отправляет приглашение. */
function InviteNow({ view, publicNumber }: { view: ContextView; publicNumber: number }) {
  const { send, pending } = useInvite(publicNumber);
  return (
    <Button pending={pending} onClick={() => void send(view.requestId)}>
      {view.label}
    </Button>
  );
}

/** Выбор заказа в окне: радио по подходящим заказам; кнопка отправки — одна, в окне. */
function InvitePick({ view, publicNumber, device }: { view: PickView; publicNumber: number; device: Device }) {
  const { send, pending } = useInvite(publicNumber);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(view.options.length === 1 ? (view.options[0]?.requestId ?? null) : null);
  const [error, setError] = useState<string | undefined>();
  const Window = device === "mobile" ? Sheet : Dialog;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chosen === null) {
      setError(t.errors.choose);
      return;
    }
    setError(undefined);
    if (await send(chosen)) setOpen(false);
  }

  return (
    <Window title={t.sheet.title} description={t.sheet.description} trigger={<Button>{view.label}</Button>} open={open} onOpenChange={setOpen}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Stack>
          <RadioGroup legend={t.sheet.legend} {...(error ? { error } : {})}>
            {view.options.map((option) => (
              <RadioCard
                key={option.requestId}
                name="requestId"
                value={option.requestId}
                label={option.label}
                checked={chosen === option.requestId}
                onChange={() => {
                  setChosen(option.requestId);
                  setError(undefined);
                }}
              />
            ))}
          </RadioGroup>
          <Button type="submit" full={device === "mobile"} pending={pending}>
            {t.sheet.submit}
          </Button>
        </Stack>
      </form>
    </Window>
  );
}

/** Кнопка приглашения на странице мастера: известный заказ — сразу, иначе выбор в шторке (телефон) или окне (компьютер). */
export function InviteControl({ view, publicNumber, device }: { view: ContextView | PickView; publicNumber: number; device: Device }) {
  return view.kind === "context" ? <InviteNow view={view} publicNumber={publicNumber} /> : <InvitePick view={view} publicNumber={publicNumber} device={device} />;
}
