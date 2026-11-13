"use client";

import { ru } from "@/i18n/ru";
import { Button, Notice, Stack, TextField } from "@/kit";
import { useActionForm } from "../../_shell/form";
import { sampleAction } from "./form-sample-actions";

const t = ru.app.kit.showcase.formSample;

/** Образец формы на `useActionForm`: подключение через `onSubmit` (не `action={…}`), ошибка у поля, поле не сбрасывается. */
export function FormSample() {
  const form = useActionForm(sampleAction);
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack>
        <TextField label={t.label} name="value" autoComplete="off" error={form.fieldErrors.value} />
        {form.error && (
          <Notice tone="danger" live>
            {form.error}
          </Notice>
        )}
        <Button type="submit" pending={form.pending}>
          {t.submit}
        </Button>
        {/* Вторая кнопка отправки: её name=value доходит до действия, у первой имени нет. */}
        <Button type="submit" name="intent" value="again" variant="secondary" pending={form.pending}>
          {t.submitAgain}
        </Button>
      </Stack>
    </form>
  );
}
