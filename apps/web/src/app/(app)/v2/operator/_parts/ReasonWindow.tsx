"use client";

import { useState } from "react";
import { Button, Dialog, HiddenField, Sheet, Stack, TextArea } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { LinkButton } from "../../../_shell/LinkButton";
import { useOperatorForm } from "./form";
import { SecondFactorField } from "./SecondFactorField";

/** Подписи окна причины: открыватель, заголовок и пояснение окна, поле, кнопка и итог. */
export type ReasonTexts = { open: string; title: string; description: string; reason: string; submit: string; done: string };

/** Причина отказа — тот же предел, что у схем модулей (operator, identity): до 500 символов. */
const REASON_MAX = 500;

type FormProps = {
  action: (input: Record<string, FormDataEntryValue>) => Promise<ActionResult<unknown>>;
  fields: Readonly<Record<string, string>>;
  texts: ReasonTexts;
  full: boolean;
  onDone: () => void;
};

/**
 * Форма в окне: монтируется при каждом открытии — прошлые ошибки и набранное не остаются. Действие с деньгами (отказ
 * банка) может попросить код из приложения — поле кода появляется над кнопкой (`SecondFactorField`).
 */
function ReasonForm({ action, fields, texts, full, onDone }: FormProps) {
  const form = useOperatorForm(action, { onSuccess: onDone });
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack>
        {Object.entries(fields).map(([name, value]) => (
          <HiddenField key={name} name={name} value={value} />
        ))}
        <TextArea label={texts.reason} name="reason" required maxLength={REASON_MAX} rows={3} error={form.fieldErrors.reason} />
        <FormError error={form.error} atField={Boolean(form.fieldErrors.reason)} />
        <SecondFactorField form={form} />
        <Button type="submit" full={full} pending={form.pending}>
          {texts.submit}
        </Button>
      </Stack>
    </form>
  );
}

export type ReasonWindowProps = Omit<FormProps, "full" | "onDone"> & {
  device: Device;
  /** Решение записано: окно уже закрыто, вызывающий объявляет итог (`useDecisionDone`). */
  onDone: (text: string) => void;
};

/**
 * Отказ с причиной (отказ банка, отклонение документов, отказ в отзыве согласия, отклонение регистрации): тихая кнопка в
 * карточке открывает шторку (телефон) или диалог (компьютер) с полем причины. Пока окно закрыто, в карточке одно решение
 * «да» и эта тихая кнопка — карточки очереди не спорят за главную кнопку экрана.
 */
export function ReasonWindow({ device, onDone, ...form }: ReasonWindowProps) {
  const [open, setOpen] = useState(false);
  const Window = device === "mobile" ? Sheet : Dialog;
  return (
    <Window title={form.texts.title} description={form.texts.description} trigger={<LinkButton label={form.texts.open} />} open={open} onOpenChange={setOpen}>
      <ReasonForm
        {...form}
        full={device === "mobile"}
        onDone={() => {
          setOpen(false);
          onDone(form.texts.done);
        }}
      />
    </Window>
  );
}
