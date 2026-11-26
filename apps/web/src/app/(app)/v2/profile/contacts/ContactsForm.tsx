"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, InstagramField, Stack, toast } from "@/kit";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { saveContactsAction } from "./actions";

const t = ru.app.profile.contacts;
const FORM = "contacts-form";

/**
 * Instagram: одно необязательное поле, ошибки формата — у поля (пояснения рядом нет: что вводить, видно по «@» в поле, а
 * допустимые символы назовёт ошибка). «Сохранить» — главное действие экрана (в доке на телефоне).
 * После сохранения в поле остаётся значение, как его записал сервер (без «@»), и тост «Сохранено».
 */
export function ContactsForm({ initial }: { initial: string }) {
  const [saved, setSaved] = useState(initial);
  const form = useActionForm(saveContactsAction, {
    onSuccess: (data) => {
      setSaved(data.instagram ?? "");
      toast(t.saved);
    },
  });
  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack>
            <InstagramField key={saved} label={t.instagram.label} name="instagram" defaultValue={saved} error={form.fieldErrors.instagram} />
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
