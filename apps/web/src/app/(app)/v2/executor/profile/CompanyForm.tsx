"use client";

import { useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Checkbox, CityField, Columns, MoneyField, Notice, RadioCard, RadioGroup, Stack, TextArea, TextField, toast } from "@/kit";
import { kztToTiyn } from "@/modules/payments/client";
import { SUGGESTED_CITIES } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { LeaveGuard } from "../../../_shell/LeaveGuard";
import { saveCompanyAction } from "./actions";
import { companySchema, MEASUREMENT_TERMS, toNumber, type CompanyInput } from "./_parts/company-schema";
import type { CompanyValues } from "./_parts/company-view";

const t = ru.app.masterCompany.company.form;
const FORM = "company-form";

/** Плата за замер из состояния формы → тиыны для начального значения поля (нет числа — пусто). */
function feeTiyn(raw: string): bigint | null {
  const n = toNumber(raw);
  return n === null || !Number.isInteger(n) || n < 0 ? null : kztToTiyn(n);
}

type Props = { initial: CompanyValues; types: readonly { id: string; name: string }[]; device: Device };

/**
 * Форма компании: о себе, опыт, что делаете, условия замера, город. «Сохранить» — главное действие экрана (в доке на
 * телефоне). Ошибки — у полей. После сохранения «О себе» показан так, как его записал сервер (маска убрала контакты и
 * название — об этом плашка). Пояснения — по нажатию, постоянных подсказок под полями нет.
 */
export function CompanyForm({ initial, types, device }: Props) {
  const [about, setAbout] = useState(initial.about);
  const [years, setYears] = useState(initial.years);
  const [specs, setSpecs] = useState<ReadonlySet<string>>(new Set(initial.specializationIds));
  const [terms, setTerms] = useState(initial.terms);
  const [fee, setFee] = useState(initial.fee);
  const [city, setCity] = useState(initial.city);
  const [masked, setMasked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const root = useRef<HTMLFormElement>(null);

  // Значения держит состояние формы; «опыт — не число» даёт NaN и ошибку у поля (схема чистая: её читают и браузер, и сервер).
  const input = (): CompanyInput => ({
    about,
    yearsExperience: toNumber(years) ?? Number.NaN,
    specializationIds: [...specs],
    measurementTerms: terms,
    measurementFee: terms === "FEE_IF_NO_DEAL" ? toNumber(fee) : null,
    city,
  });
  const form = useActionForm(saveCompanyAction, {
    formRef: root,
    toInput: input,
    onSuccess: (data) => {
      setAbout(data.about);
      setDirty(false);
      setMasked(data.aboutMasked);
      toast(t.saved);
    },
  });
  // Ошибки проверки в браузере и с сервера — одни и те же; фокус на первое поле и снятие ошибки при правке — у useActionForm.
  const err = form.fieldErrors;

  /** Проверка в браузере теми же правилами, что на сервере; без ошибок — отправка. Плашка маски прошлого сохранения снимается. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMasked(false);
    const parsed = companySchema.safeParse(input());
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key !== "" && found[key] === undefined) found[key] = issue.message;
      }
      form.reject(found);
      return;
    }
    void form.submit(new FormData());
  }

  const toggle = (id: string, on: boolean) =>
    setSpecs((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const atField = Object.keys(err).length > 0;

  return (
    <>
      <Card>
        <form id={FORM} ref={root} method="post" onSubmit={submit} onInput={() => setDirty(true)} noValidate>
          <Stack gap="section">
            <Stack>
              <TextArea label={t.about.label} name="about" value={about} onChange={(e) => setAbout(e.target.value)} rows={6} maxLength={2000} error={err.about} />
              {masked && <Notice tone="info">{t.masked}</Notice>}
              <TextField
                label={t.experience}
                name="yearsExperience"
                value={years}
                onChange={(e) => setYears(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                error={err.yearsExperience}
              />
            </Stack>

            <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-2 text-sub font-medium text-ink">{t.specializations}</legend>
              {types.length === 0 && <p className="text-body text-muted">{t.noTypes}</p>}
              <Columns count={2}>
                {types.map((type) => (
                  <Checkbox key={type.id} name="specializationIds" value={type.id} label={type.name} checked={specs.has(type.id)} onChange={(e) => toggle(type.id, e.target.checked)} />
                ))}
              </Columns>
              {err.specializationIds && (
                <p role="alert" className="text-sub text-danger">
                  {err.specializationIds}
                </p>
              )}
            </fieldset>

            <Stack>
              <RadioGroup legend={t.measurement} {...(err.measurementTerms ? { error: err.measurementTerms } : {})}>
                {MEASUREMENT_TERMS.map((value) => {
                  // Подпись — только у варианта, где она добавляет факт (кто платит за выезд).
                  const option: { label: string; description?: string } = t.measurementOptions[value];
                  return (
                    <RadioCard
                      key={value}
                      name="measurementTerms"
                      value={value}
                      label={option.label}
                      {...(option.description ? { description: option.description } : {})}
                      checked={terms === value}
                      onChange={() => setTerms(value)}
                    />
                  );
                })}
              </RadioGroup>
              {terms === "FEE_IF_NO_DEAL" && (
                <MoneyField
                  label={t.fee}
                  name="measurementFee"
                  defaultTiyn={feeTiyn(fee)}
                  onValueChange={(tiyn) => setFee(tiyn === null ? "" : (tiyn / 100n).toString())}
                  error={err.measurementFee}
                />
              )}
            </Stack>

            <Stack>
              <h2 className="text-title-2 text-ink">{t.address.title}</h2>
              <CityField label={t.address.city} name="city" suggestions={SUGGESTED_CITIES} value={city} onChange={setCity} maxLength={100} error={err.city} />
            </Stack>
            <FormError error={form.error} atField={atField} />
          </Stack>
        </form>
      </Card>
      <LeaveGuard dirty={dirty} device={device} />
      <ActionDock>
        <Button type="submit" form={FORM} pending={form.pending}>
          {t.save}
        </Button>
      </ActionDock>
    </>
  );
}
