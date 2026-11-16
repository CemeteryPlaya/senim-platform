"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Explain, IbanField, Stack, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { savePayoutAction } from "./actions";
import { ibanProblem } from "./payout-view";

const t = ru.app.masterCompany.payout.form;
const FORM = "payout-form";

/**
 * Ввод IBAN. Номер проверяется в браузере теми же правилами, что на сервере (формат и контрольная сумма), и только потом
 * уходит. Поле пустое и после сохранения: полный номер не возвращается в браузер, экран обновляется и показывает последние
 * 4 знака. «Сохранить счёт» — главное действие экрана (док на телефоне).
 */
export function PayoutForm({ device }: { device: Device }) {
  const router = useRouter();
  // Номер держит поле IbanField (в форму уходит 20 знаков без пробелов); после сохранения поле пересоздаётся пустым.
  const [round, setRound] = useState(0);
  const [local, setLocal] = useState<string | undefined>();
  const form = useActionForm(savePayoutAction, {
    toInput: (fd) => ({ iban: String(fd.get("iban") ?? "") }),
    onSuccess: () => {
      setRound((n) => n + 1);
      setLocal(undefined);
      toast(t.saved);
      router.refresh();
    },
  });
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLFormElement>(null);
  const error = local ?? form.fieldErrors.iban;

  // Ошибка проверки в браузере — фокус на поле (ошибки с сервера — фокус ведёт сам useActionForm).
  useEffect(() => {
    if (attempt === 0) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function submit(event: FormEvent<HTMLFormElement>) {
    const problem = ibanProblem(String(new FormData(event.currentTarget).get("iban") ?? ""));
    setLocal(problem ?? undefined);
    if (problem === null) return form.onSubmit(event);
    event.preventDefault();
    setAttempt((n) => n + 1);
  }

  return (
    <>
      <Card>
        <form id={FORM} ref={root} method="post" onSubmit={submit} onInput={() => setLocal(undefined)} noValidate>
          <Stack>
            <IbanField key={round} label={t.iban} name="iban" error={error} />
            <div>
              <Explain label={t.explain.label} title={t.explain.title} device={device}>
                {t.explain.points.map((point) => (
                  <p key={point} className="mb-2 last:mb-0">
                    {point}
                  </p>
                ))}
              </Explain>
            </div>
            <FormError error={form.error} atField={Boolean(error)} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {t.save}
        </Button>
      </ActionDock>
    </>
  );
}
