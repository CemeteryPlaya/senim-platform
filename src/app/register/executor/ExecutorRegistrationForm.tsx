"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input, RadioCards } from "@/ui";
import { registerExecutorAction } from "./actions";

const t = ru.identity.registration;

type LegalForm = keyof typeof t.legalForms;
const LEGAL_FORMS = Object.keys(t.legalForms) as LegalForm[];
const isLegalForm = (v: string): v is LegalForm => (LEGAL_FORMS as string[]).includes(v);

/**
 * Анкета исполнителя. Подписи имени и номера зависят от формы работы: ТОО — наименование и БИН,
 * плюс ФИО и ИИН директора — он подписывает договор своей ЭЦП.
 */
export function ExecutorRegistrationForm({ defaultLegalForm = "SELF_EMPLOYED" }: { defaultLegalForm?: LegalForm }) {
  const [legalForm, setLegalForm] = useState<LegalForm>(defaultLegalForm);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const idKind = legalForm === "TOO" ? "BIN" : "IIN";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "");
    setErrors({});
    setFormError(undefined);
    startTransition(async () => {
      // При успехе действие делает redirect на экран ожидания — сюда возвращается только ошибка.
      const res = await registerExecutorAction({
        legalForm,
        legalName: field("legalName"),
        binIin: field("binIin"),
        city: field("city"),
        yearsExperience: field("yearsExperience"),
        // Поля директора есть в форме только у ТОО; у остальных схема их игнорирует.
        directorName: field("directorName"),
        directorIin: field("directorIin"),
      });
      if (res.ok) return;
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) setErrors(res.fieldErrors);
      else setFormError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <RadioCards
        label={t.legalForm}
        name="legalForm"
        value={legalForm}
        onChange={(v) => isLegalForm(v) && setLegalForm(v)}
        options={LEGAL_FORMS.map((value) => ({ value, label: t.legalForms[value], description: t.legalFormHints[value] }))}
        error={errors.legalForm?.[0]}
        required
      />
      <Input
        label={t.legalNameLabel[legalForm]}
        hint={t.legalNameHint}
        error={errors.legalName?.[0]}
        name="legalName"
        autoComplete={legalForm === "SELF_EMPLOYED" ? "name" : "organization"}
        maxLength={200}
        required
      />
      <Input
        label={t.binIinLabel[idKind]}
        hint={t.binIinHint}
        error={errors.binIin?.[0]}
        name="binIin"
        inputMode="numeric"
        autoComplete="off"
        maxLength={15}
        required
      />
      {legalForm === "TOO" && (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-lg font-bold text-ink">{t.director.title}</legend>
          <p className="text-base text-ink-soft">{t.director.lead}</p>
          <Input
            label={t.director.nameLabel}
            hint={t.director.nameHint}
            error={errors.directorName?.[0]}
            name="directorName"
            autoComplete="off"
            maxLength={120}
            required
          />
          <Input
            label={t.director.iinLabel}
            hint={t.director.iinHint}
            error={errors.directorIin?.[0]}
            name="directorIin"
            inputMode="numeric"
            autoComplete="off"
            maxLength={15}
            required
          />
        </fieldset>
      )}
      <Input label={t.cityLabel} error={errors.city?.[0]} name="city" defaultValue={t.defaultCity} autoComplete="address-level2" required />
      <Input
        label={t.experienceLabel}
        error={errors.yearsExperience?.[0]}
        name="yearsExperience"
        type="number"
        inputMode="numeric"
        min={0}
        max={60}
        defaultValue={0}
        required
      />
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
