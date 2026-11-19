"use client";

import { ru } from "@/i18n/ru";
import { Button, HiddenField, Stack, toast } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { setRequestFileHiddenAction } from "./actions";

const t = ru.app.operatorDisputes.requestFiles;

/**
 * «Скрыть» или «Вернуть» один файл дизайн-проекта. Кнопка второстепенная (на экране нет главного действия), подпись для
 * диктора называет файл. Страницу перерисовывает само действие (`revalidatePath`); двойное нажатие гасит форма.
 */
export function FileVisibilityForm({ fileId, hidden, file }: { fileId: string; hidden: boolean; file: string }) {
  const form = useActionForm(setRequestFileHiddenAction, { onSuccess: () => toast(hidden ? t.restoredDone : t.hiddenDone) });
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack gap="tight">
        <HiddenField name="fileId" value={fileId} />
        <HiddenField name="hidden" value={hidden ? "0" : "1"} />
        <FormError error={form.error} />
        <Button type="submit" variant="secondary" size="sm" pending={form.pending} aria-label={hidden ? t.restoreLabel(file) : t.hideLabel(file)}>
          {hidden ? t.restore : t.hide}
        </Button>
      </Stack>
    </form>
  );
}
