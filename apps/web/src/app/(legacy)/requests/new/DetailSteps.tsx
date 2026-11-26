"use client";

import { useState, type ReactNode } from "react";
import { LIMITS } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Input, Textarea } from "@/ui";
import { Uploader } from "@/app/(legacy)/_components/uploader";
import { FormError } from "../_parts/ActionButton";
import { first, NextButton, SkipButton, StepForm, useStep, type StepBase } from "./StepForm";

const w = ru.requests.wizard;
const pre = ru.requests.pre;

// ─── Онлайн-замер (сценарий 5) ───────────────────────────────────────────────

/** Онлайн-замер (сценарий 5, ADR-005): как снять размеры самому — по шагам. Показывается в «Для продвинутых». */
export function SelfMeasureGuide() {
  const s = pre.selfMeasure;
  return (
    <section aria-labelledby="self-measure" className="flex flex-col gap-3 rounded-card bg-accent-soft p-5">
      <h2 id="self-measure" className="text-lg font-bold text-ink">
        {s.howTitle}
      </h2>
      <ol className="flex list-decimal flex-col gap-2 pl-6 text-base text-ink">
        {s.how.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

// ─── 3. Фото и описание ──────────────────────────────────────────────────────

/** Фото места и описание своими словами. Необязательно, кроме онлайн-замера: там нужно фото стены с рулеткой. */
export function RoomStep(props: StepBase & { photos: { id: string; src: string }[]; description: string; selfMeasure: boolean; aiSlot?: ReactNode }) {
  const { submit, pending, error, errors } = useStep(props);
  const [photoIds, setPhotoIds] = useState(props.photos.map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState(props.description);
  const [photosError, setPhotosError] = useState<string>();
  // «Пропустить» сохраняет то же, что «Далее»: шаг необязательный, кнопка говорит об этом прямо.
  const save = () => {
    if (props.selfMeasure && photoIds.length === 0) return setPhotosError(pre.selfMeasure.photosRequired);
    setPhotosError(undefined);
    submit({ screen: "room", photoFileIds: photoIds, description });
  };
  const r = w.room;
  return (
    <StepForm
      title={r.title}
      lead={props.selfMeasure ? pre.selfMeasure.roomHint : r.lead}
      frame={props.frame}
      errors={errors}
      onSubmit={save}
      actions={
        <>
          {!props.selfMeasure && <SkipButton pending={pending || busy} onClick={save} />}
          <NextButton pending={pending || busy} />
        </>
      }
    >
      <Uploader
        purpose="REQUEST_ROOM"
        label={r.photosLabel}
        hint={props.selfMeasure ? pre.selfMeasure.roomHint : r.hint}
        max={LIMITS.photos}
        initial={props.photos.map((p) => ({ id: p.id, url: p.src }))}
        onChange={setPhotoIds}
        onBusyChange={setBusy}
        error={photosError ?? first(errors, "photoFileIds")}
      />
      {props.aiSlot}
      <Textarea
        label={r.description}
        hint={`${r.descriptionHint}. ${r.counter(description.length, LIMITS.description)}`}
        optional
        value={description}
        maxLength={LIMITS.description}
        onChange={(e) => setDescription(e.target.value)}
        error={first(errors, "description")}
      />
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 4. Где и когда ──────────────────────────────────────────────────────────

/** ADR-016: в заявке только город и дата — адрес и точку покупатель указывает в сделке (v2). */
export type PlaceInitial = { city: string; desiredDate: string };

export function PlaceStep(props: StepBase & { initial: PlaceInitial }) {
  const { submit, pending, error, errors } = useStep(props);
  const [form, setForm] = useState(props.initial);
  const set = (patch: Partial<PlaceInitial>) => setForm((f) => ({ ...f, ...patch }));
  const p = w.place;
  return (
    <StepForm
      title={p.title}
      lead={p.lead}
      frame={props.frame}
      errors={errors}
      onSubmit={() => submit({ screen: "place", city: form.city, desiredDate: form.desiredDate || null })}
      actions={<NextButton pending={pending} />}
    >
      <Input label={p.city} value={form.city} autoComplete="address-level2" maxLength={LIMITS.city} onChange={(e) => set({ city: e.target.value })} error={first(errors, "city")} />
      <Input
        label={p.desiredDate}
        hint={p.desiredDateHint}
        type="date"
        optional
        value={form.desiredDate}
        onChange={(e) => set({ desiredDate: e.target.value })}
        error={first(errors, "desiredDate")}
      />
      <FormError message={error} />
    </StepForm>
  );
}
