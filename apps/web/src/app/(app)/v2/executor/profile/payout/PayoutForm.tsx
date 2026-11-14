"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Explain, Stack, TextField, toast } from "@/kit";
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
  const [iban, setIban] = useState("");
  const [local, setLocal] = useState<string | undefined>();
  const form = useActionForm(savePayoutAction, {
    toInput: () => ({ iban }),
    onSuccess: () => {
      setIban("");
      setLocal(undefined);
      toast(t.saved);
      router.refresh();
    },
  });
  const error = local ?? form.fieldErrors.iban;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = ibanProblem(iban);
    setLocal(problem ?? undefined);
    if (problem === null) void form.submit(new FormData());
  }

  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={submit} noValidate>
          <Stack>
            <TextField
              label={t.iban}
              name="iban"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              className="font-mono tabular-nums"
              error={error}
            />
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
