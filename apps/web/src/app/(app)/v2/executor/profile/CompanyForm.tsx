"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Checkbox, Explain, Notice, RadioCard, RadioGroup, Stack, TextArea, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { saveCompanyAction } from "./actions";
import { MEASUREMENT_TERMS, toNumber, type CompanyInput } from "./_parts/company-schema";
import type { CompanyValues } from "./_parts/company-view";

const t = ru.app.masterCompany.company.form;
const FORM = "company-form";

type Props = { initial: CompanyValues; types: readonly { id: string; name: string }[]; device: Device };

/**
 * Форма компании: о себе, опыт, что делаете, условия замера, адрес. «Сохранить» — главное действие экрана (в доке на
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
  const [district, setDistrict] = useState(initial.district);
  const [street, setStreet] = useState(initial.streetAddress);
  const [masked, setMasked] = useState(false);

  const form = useActionForm(saveCompanyAction, {
    // Значения держит состояние формы; схема действия на сервере проверяет их (число опыта — «не число» даёт NaN и ошибку у поля).
    toInput: (): CompanyInput => ({
      about,
      yearsExperience: toNumber(years) ?? Number.NaN,
      specializationIds: [...specs],
      measurementTerms: terms,
      measurementFee: terms === "FEE_IF_NO_DEAL" ? toNumber(fee) : null,
      city,
      district,
      streetAddress: street,
    }),
    onSuccess: (data) => {
      setAbout(data.about);
      setMasked(data.aboutMasked);
      toast(t.saved);
    },
  });

  const toggle = (id: string, on: boolean) =>
    setSpecs((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const err = form.fieldErrors;
  const atField = Object.keys(err).length > 0;

  return (
    <>
      <Card>
        <form id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack gap="section">
            <Stack>
              <TextArea label={t.about.label} name="about" value={about} onChange={(e) => setAbout(e.target.value)} rows={6} maxLength={2000} error={err.about} />
              <div>
                <Explain label={t.about.explain.label} title={t.about.explain.title} device={device}>
                  <p>{t.about.explain.body}</p>
                </Explain>
              </div>
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
              {types.map((type) => (
                <Checkbox key={type.id} name="specializationIds" value={type.id} label={type.name} checked={specs.has(type.id)} onChange={(e) => toggle(type.id, e.target.checked)} />
              ))}
              {err.specializationIds && (
                <p role="alert" className="text-sub text-danger">
                  {err.specializationIds}
                </p>
              )}
            </fieldset>

            <Stack>
              <RadioGroup legend={t.measurement} {...(err.measurementTerms ? { error: err.measurementTerms } : {})}>
                {MEASUREMENT_TERMS.map((value) => (
                  <RadioCard
                    key={value}
                    name="measurementTerms"
                    value={value}
                    label={t.measurementOptions[value].label}
                    description={t.measurementOptions[value].description}
                    checked={terms === value}
                    onChange={() => setTerms(value)}
                  />
                ))}
              </RadioGroup>
              {terms === "FEE_IF_NO_DEAL" && (
                <TextField label={t.fee} name="measurementFee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" autoComplete="off" error={err.measurementFee} />
              )}
            </Stack>

            <Stack>
              <h2 className="text-section text-ink">{t.address.title}</h2>
              <TextField label={t.address.city} name="city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={100} error={err.city} />
              <TextField
                label={`${t.address.district} (${t.optional})`}
                name="district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                autoComplete="address-level3"
                maxLength={100}
                error={err.district}
              />
              <TextField
                label={`${t.address.street} (${t.optional})`}
                name="streetAddress"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                autoComplete="street-address"
                maxLength={200}
                error={err.streetAddress}
              />
              <div>
                <Explain label={t.address.explain.label} title={t.address.explain.title} device={device}>
                  <p>{t.address.explain.body}</p>
                </Explain>
              </div>
            </Stack>
            <FormError error={form.error} atField={atField} />
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
