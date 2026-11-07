"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, focusFirstInvalid, Input } from "@/ui";
import { introduceAction } from "./actions";

const t = ru.identity.introduction;
const ci = ru.identity.clientIdentity;

/** ФИО и ИИН один раз. next — куда вернуться после сохранения (проверяет сервер). */
export function IntroductionForm({ next, defaultFullName }: { next: string | null; defaultFullName: string | null }) {
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(errors).length > 0 && form.current) focusFirstInvalid(form.current);
  }, [errors]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setErrors({});
    setFormError(undefined);
    startTransition(async () => {
      // При успехе действие ведёт дальше (redirect) — сюда возвращается только ошибка.
      const res = await introduceAction({ fullName: String(data.get("fullName") ?? ""), iin: String(data.get("iin") ?? ""), next });
      if (res.ok) return;
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) setErrors(res.fieldErrors);
      else setFormError(res.error);
    });
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Input
        label={ci.fullName}
        hint={ci.fullNameHint}
        name="fullName"
        autoComplete="name"
        maxLength={200}
        defaultValue={defaultFullName ?? undefined}
        error={errors.fullName?.[0]}
        required
      />
      <Input label={ci.iin} hint={ci.iinHint} name="iin" inputMode="numeric" autoComplete="off" maxLength={15} error={errors.iin?.[0]} required />
      {formError && (
        <Alert tone="danger" live="assertive">
          {formError}
        </Alert>
      )}
      <Button type="submit" loading={pending} fullWidth>
        {t.submit}
      </Button>
    </form>
  );
}
