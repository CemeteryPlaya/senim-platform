"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Narrow, PageTitle, Stack, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../_shell/FormError";
import { useClientKey } from "../../../../../_shell/client-key";
import { useActionForm } from "../../../../../_shell/form";
import { LeaveGuard } from "../../../../../_shell/LeaveGuard";
import { saveShowcaseAction } from "../actions";
import { ShowcaseFields, type ShowcaseChoice } from "./ShowcaseFields";

const t = ru.app.deal.showcase;
const FORM = "showcase-form";

type Props = {
  dealId: string;
  dealTitle: string;
  backHref: string;
  initial: ShowcaseChoice;
  addressOptions: readonly ShowcaseChoice["address"][];
  device: Device;
};

/** Выбор показа в профиле мастера: «Сохранить» — главное действие; после успеха — тост и карточка сделки. */
export function ShowcaseForm({ dealId, dealTitle, backHref, initial, addressOptions, device }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<ShowcaseChoice>(initial);
  const [done, setDone] = useState(false);
  const retry = useClientKey();
  const form = useActionForm(saveShowcaseAction, {
    toInput: () => ({ dealId, ...value, clientKey: retry.keyFor(value) }),
    onSuccess: () => {
      retry.done();
      setDone(true);
      toast(t.saved);
      router.replace(backHref);
    },
  });
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (done) return event.preventDefault();
    form.onSubmit(event);
  }

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: backHref, label: dealTitle }} lead={t.lead} />
        <Card>
          <form id={FORM} method="post" onSubmit={submit} noValidate>
            <Stack gap="section">
              <ShowcaseFields value={value} onChange={setValue} addressOptions={addressOptions} {...(form.fieldErrors.address ? { addressError: form.fieldErrors.address } : {})} />
              <FormError error={form.error} />
            </Stack>
          </form>
        </Card>
        <LeaveGuard dirty={!done && dirty} device={device} />
        <ActionDock>
          <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </Narrow>
  );
}
