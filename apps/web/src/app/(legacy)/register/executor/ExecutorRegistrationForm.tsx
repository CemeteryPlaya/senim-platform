"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, focusFirstInvalid, FullscreenStep, Input, RadioCards } from "@/ui";
import { registerExecutorAction } from "./actions";

const t = ru.identity.registration;
const addr = ru.companies.address;

type LegalForm = keyof typeof t.legalForms;
const LEGAL_FORMS = Object.keys(t.legalForms) as LegalForm[];
const isLegalForm = (v: string): v is LegalForm => (LEGAL_FORMS as string[]).includes(v);

/** ФИО и последние 4 цифры ИИН из знакомства (№26): ИП и самозанятому не вводить их второй раз. */
export type RegistrationOwner = { fullName: string | null; iinLast4: string | null };

/**
 * Анкета исполнителя. Подписи имени и номера зависят от формы работы: ТОО — наименование и БИН,
 * плюс ФИО и ИИН директора — он подписывает договор своей ЭЦП; ИП — ФИО владельца (подписывает он).
 * ИП и самозанятый работают по ИИН владельца аккаунта из знакомства — номер не вводят (его берёт identity).
 */
export function ExecutorRegistrationForm({
  defaultLegalForm = "SELF_EMPLOYED",
  owner,
  intro,
}: {
  defaultLegalForm?: LegalForm;
  owner?: RegistrationOwner;
  /** Над полями: пояснение или причина отказа. */
  intro?: ReactNode;
}) {
  const [legalForm, setLegalForm] = useState<LegalForm>(defaultLegalForm);
  const ownIinLast4 = owner?.iinLast4 ?? null;
  const ownName = owner?.fullName ?? undefined;
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  // После неудачной отправки — фокус на первое поле с ошибкой (aria-invalid ставят сами поля).
  useEffect(() => {
    if (Object.keys(errors).length > 0 && form.current) focusFirstInvalid(form.current);
  }, [errors]);

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
        district: field("district"),
        streetAddress: field("streetAddress"),
        yearsExperience: field("yearsExperience"),
        // Поля подписанта: директор — только у ТОО, владелец — только у ИП; лишние схема игнорирует.
        ownerName: field("ownerName"),
        directorName: field("directorName"),
        directorIin: field("directorIin"),
      });
      if (res.ok || leaveIfSignedOut(res)) return;
      if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) setErrors(res.fieldErrors);
      else setFormError(res.error);
    });
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate>
      <FullscreenStep
        title={t.title}
        back={{ href: "/" }}
        action={
          <>
            {formError && (
              <Alert tone="danger" live="assertive">
                {formError}
              </Alert>
            )}
            <Button type="submit" loading={pending} fullWidth>
              {t.submit}
            </Button>
          </>
        }
      >
        {intro}
        <div className="flex flex-col gap-6">
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
            // Самозанятый: наименование — его ФИО из знакомства (подставляется один раз, введённое не стирается).
            defaultValue={defaultLegalForm === "SELF_EMPLOYED" ? ownName : undefined}
            required
          />
          {legalForm !== "TOO" && ownIinLast4 !== null && <p className="text-base text-ink-soft">{t.ownIin(ownIinLast4)}</p>}
          {legalForm === "TOO" && (
            <Input
              label={t.binLabel}
              hint={t.binIinHint}
              error={errors.binIin?.[0]}
              name="binIin"
              inputMode="numeric"
              autoComplete="off"
              maxLength={15}
              required
            />
          )}
          {legalForm !== "TOO" && errors.binIin?.[0] && (
            <Alert tone="danger" live="assertive">
              {errors.binIin[0]}
            </Alert>
          )}
          {legalForm === "IP" && (
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-lg font-bold text-ink">{t.owner.title}</legend>
              <p className="text-base text-ink-soft">{t.owner.lead}</p>
              <Input
                label={t.owner.nameLabel}
                hint={t.owner.nameHint}
                error={errors.ownerName?.[0]}
                name="ownerName"
                autoComplete="name"
                maxLength={120}
                defaultValue={ownName}
                required
              />
            </fieldset>
          )}
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
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-lg font-bold text-ink">{addr.title}</legend>
            <p className="text-base text-ink-soft">{addr.lead}</p>
            <Input label={t.cityLabel} error={errors.city?.[0]} name="city" defaultValue={t.defaultCity} autoComplete="address-level2" required />
            <Input label={addr.district} hint={addr.districtHint} error={errors.district?.[0]} name="district" autoComplete="address-level3" maxLength={100} optional />
            <Input label={addr.street} hint={addr.streetHint} error={errors.streetAddress?.[0]} name="streetAddress" autoComplete="street-address" maxLength={200} optional />
          </fieldset>
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
        </div>
      </FullscreenStep>
    </form>
  );
}
