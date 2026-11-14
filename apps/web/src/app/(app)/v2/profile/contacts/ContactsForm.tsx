"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Explain, Stack, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { saveContactsAction } from "./actions";

const t = ru.app.profile.contacts;
const FORM = "contacts-form";

/**
 * Instagram: одно необязательное поле, ошибки формата — у поля. «Сохранить» — главное действие экрана (в доке на телефоне).
 * После сохранения в поле остаётся значение, как его записал сервер (без «@»), и тост «Сохранено».
 */
export function ContactsForm({ initial, device }: { initial: string; device: Device }) {
  const [value, setValue] = useState(initial);
  const form = useActionForm(saveContactsAction, {
    onSuccess: (data) => {
      setValue(data.instagram ?? "");
      toast(t.saved);
    },
  });
  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack>
            <TextField
              label={t.instagram.label}
              name="instagram"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="text"
              maxLength={40}
              error={form.fieldErrors.instagram}
            />
            <div>
              <Explain label={t.instagram.explain.label} title={t.instagram.explain.title} device={device}>
                <p>{t.instagram.explain.body}</p>
              </Explain>
            </div>
            <FormError error={form.error} atField={Boolean(form.fieldErrors.instagram)} />
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
