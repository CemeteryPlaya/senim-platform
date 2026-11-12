"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, Checkbox, cn, focusFirstInvalid, Input, RadioCards, Select, Textarea } from "@/ui";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { createWorkFromDeal } from "../actions";

const t = ru.companies.dealPortfolio.form;
const p = ru.companies.portfolio;

type Props = {
  dealId: string;
  photos: { id: string; src: string | null }[];
  types: { id: string; name: string }[];
  initial: { furnitureTypeId: string; style: StyleKey | ""; title: string; place: string };
};

const toPrice = (raw: string): number | null => {
  const clean = raw.replace(/[\s ]/g, "");
  return clean === "" ? null : Number(clean);
};

/** Форма «Добавить в портфолио» из сделки: выбор итоговых фото, тип и стиль (подставлены из заявки), место. */
export function FromDealForm({ dealId, photos, types, initial }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(photos.map((ph) => ph.id));
  const [values, setValues] = useState({ ...initial, description: "", price: "", published: true });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));
  const err = (key: string) => errors[key]?.[0];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    startTransition(async () => {
      const result = await createWorkFromDeal({
        dealId,
        // Порядок — как на экране: первое отмеченное фото станет обложкой.
        fileIds: photos.map((ph) => ph.id).filter((id) => selected.includes(id)),
        furnitureTypeId: values.furnitureTypeId,
        style: values.style as StyleKey,
        title: values.title,
        description: values.description,
        place: values.place,
        priceFrom: toPrice(values.price),
        published: values.published,
      });
      if (!result.ok) {
        if (leaveIfSignedOut(result)) return;
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
        requestAnimationFrame(() => focusFirstInvalid(form));
        return;
      }
      router.push(`/executor/portfolio/${result.data.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-3" aria-describedby="deal-photos-hint" aria-invalid={err("fileIds") ? true : undefined}>
        <legend className="text-lg font-bold text-ink">{t.photos}</legend>
        <p id="deal-photos-hint" className="text-base text-muted">
          {t.photosHint}
        </p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-3">
          {photos.map((photo, i) => {
            const on = selected.includes(photo.id);
            return (
              <li key={photo.id}>
                <label
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-control border-2 p-2",
                    on ? "border-primary bg-accent-soft" : "border-line bg-surface",
                  )}
                >
                  {photo.src && (
                    // eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки хранилища
                    <img src={photo.src} alt="" className="aspect-square w-full rounded-badge bg-sunken object-cover" />
                  )}
                  <span className="flex min-h-control-sm items-center gap-3 text-base text-ink">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(photo.id, e.target.checked)} className="size-6 shrink-0 accent-primary" />
                    {t.photoAlt(i + 1)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {err("fileIds") && (
          <p className="text-base font-semibold text-danger" role="alert">
            {err("fileIds")}
          </p>
        )}
      </fieldset>

      <Input label={t.place} hint={t.placeHint} value={values.place} onChange={(e) => set("place", e.target.value)} maxLength={80} error={err("place")} />
      <Select
        label={p.fields.type}
        value={values.furnitureTypeId}
        onChange={(e) => set("furnitureTypeId", e.target.value)}
        options={types.map((ft) => ({ value: ft.id, label: ft.name }))}
        error={err("furnitureTypeId")}
      />
      <RadioCards
        label={p.fields.style}
        name="style"
        value={values.style}
        onChange={(v) => set("style", v as StyleKey)}
        options={Object.entries(STYLES).map(([value, s]) => ({ value, label: s.name, description: s.hint }))}
        columns={2}
        error={err("style")}
      />
      <Input label={p.fields.title} hint={p.fields.titleHint} value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={120} error={err("title")} />
      <Textarea
        label={p.fields.description}
        hint={p.fields.descriptionHint}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
        rows={4}
        maxLength={2000}
        optional
        error={err("description")}
      />
      <Input
        label={p.fields.price}
        hint={p.fields.priceHint}
        inputMode="numeric"
        value={values.price}
        onChange={(e) => set("price", e.target.value)}
        optional
        error={err("priceFrom")}
        className="max-w-60"
      />
      <Checkbox label={t.published} checked={values.published} onChange={(e) => set("published", e.target.checked)} />

      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <Button type="submit" fullWidth loading={pending}>
        {t.submit}
      </Button>
    </form>
  );
}
