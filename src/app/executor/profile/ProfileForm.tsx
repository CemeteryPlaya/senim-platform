"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { MeasurementTerms } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { Alert, Button, Checkbox, Input, RadioCards, Textarea } from "@/ui";
import { saveProfile } from "./actions";

const t = ru.companies.profile;
const TERMS: MeasurementTerms[] = ["FREE", "INCLUDED", "FEE_IF_NO_DEAL"];

export type ProfileFormValues = {
  about: string;
  yearsExperience: number;
  specializationIds: string[];
  measurementTerms: MeasurementTerms;
  measurementFee: number | null;
};

type Notice = { tone: "success" | "danger"; text: string; extra?: string } | null;

/** Число из поля ввода: пробелы-разделители допустимы, пустое поле — null. */
function toNumber(raw: string): number | null {
  const clean = raw.replace(/[\s ]/g, "");
  return clean === "" ? null : Number(clean);
}

export function ProfileForm({ initial, types }: { initial: ProfileFormValues; types: { id: string; name: string }[] }) {
  const [about, setAbout] = useState(initial.about);
  const [years, setYears] = useState(String(initial.yearsExperience));
  const [specs, setSpecs] = useState<Set<string>>(new Set(initial.specializationIds));
  const [terms, setTerms] = useState<MeasurementTerms>(initial.measurementTerms);
  const [fee, setFee] = useState(initial.measurementFee === null ? "" : String(initial.measurementFee));
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();

  const toggleSpec = (id: string, on: boolean) =>
    setSpecs((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    startTransition(async () => {
      const result = await saveProfile({
        about,
        yearsExperience: toNumber(years) ?? 0,
        specializationIds: [...specs],
        measurementTerms: terms,
        measurementFee: terms === "FEE_IF_NO_DEAL" ? toNumber(fee) : null,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      setErrors({});
      setAbout(result.data.about);
      setNotice({ tone: "success", text: t.saved, extra: result.data.aboutMasked ? t.aboutMasked : undefined });
    });
  };

  const err = (key: string) => errors[key]?.[0];

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Textarea label={t.fields.about} hint={t.fields.aboutHint} value={about} onChange={(e) => setAbout(e.target.value)} rows={6} maxLength={2000} error={err("about")} />

      <Input
        label={t.fields.experience}
        type="text"
        inputMode="numeric"
        value={years}
        onChange={(e) => setYears(e.target.value)}
        error={err("yearsExperience")}
        className="max-w-40"
      />

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-base font-semibold text-ink">{t.fields.specializations}</legend>
        <p className="mb-2 text-sm text-muted">{t.fields.specializationsHint}</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-2">
          {types.map((type) => (
            <Checkbox key={type.id} label={type.name} checked={specs.has(type.id)} onChange={(e) => toggleSpec(type.id, e.target.checked)} />
          ))}
        </div>
        {err("specializationIds") && <p className="text-sm font-semibold text-danger">{err("specializationIds")}</p>}
      </fieldset>

      <RadioCards
        label={t.fields.measurement}
        hint={t.fields.measurementHint}
        name="measurementTerms"
        value={terms}
        onChange={(v) => setTerms(v as MeasurementTerms)}
        options={TERMS.map((value) => ({ value, label: t.measurementOptions[value].label, description: t.measurementOptions[value].description }))}
        columns={3}
        error={err("measurementTerms")}
      />

      {terms === "FEE_IF_NO_DEAL" && (
        <Input
          label={t.fields.fee}
          hint={t.fields.feeHint}
          type="text"
          inputMode="numeric"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          error={err("measurementFee")}
          className="max-w-60"
        />
      )}

      {notice && (
        <Alert tone={notice.tone} live={notice.tone === "danger" ? "assertive" : "polite"}>
          {notice.text}
          {notice.extra && <span className="mt-1 block">{notice.extra}</span>}
        </Alert>
      )}

      <div>
        <Button type="submit" loading={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
