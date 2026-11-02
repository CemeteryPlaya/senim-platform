"use client";

import { useState, type ReactNode } from "react";
import { LIMITS, type RequestDetails } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Input, RadioCards, Textarea } from "@/ui";
import { Uploader } from "@/app/_components/uploader";
import { FormError } from "../_parts/ActionButton";
import { first, NextButton, SkipButton, StepForm, StepHeading, useStep, type StepBase } from "./StepForm";

const w = ru.requests.wizard;
const pre = ru.requests.pre;

// ─── 3. Размеры ──────────────────────────────────────────────────────────────

const toCm = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/** Онлайн-замер (сценарий 5, ADR-005): как снять размеры самому — по шагам. */
function SelfMeasureGuide() {
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

/**
 * Размеры необязательны: по умолчанию «Не знаю — уточнит замер». В онлайн-замере (сценарий 5) — инструкция
 * и три обязательных размера: по ним исполнители считают цену.
 */
export function SizeStep(props: StepBase & { details: RequestDetails; selfMeasure: boolean }) {
  const { submit, pending, error, errors } = useStep(props);
  const d = props.details;
  const self = props.selfMeasure;
  const [mode, setMode] = useState<"known" | "unknown">(self || d.widthCm ? "known" : "unknown");
  const [size, setSize] = useState({ w: d.widthCm?.toString() ?? "", h: d.heightCm?.toString() ?? "", d: d.depthCm?.toString() ?? "" });
  const [localError, setLocalError] = useState<string>();
  const sizeError = localError ?? first(errors, "size");
  const field = (key: "w" | "h" | "d", label: string, required: boolean) => (
    <Input
      label={label}
      optional={!required}
      inputMode="numeric"
      autoComplete="off"
      value={size[key]}
      onChange={(e) => setSize({ ...size, [key]: e.target.value })}
      error={key === "w" ? sizeError : undefined}
    />
  );
  return (
    <StepForm
      errors={errors}
      onSubmit={() => {
        if (self && (!size.w.trim() || !size.h.trim() || !size.d.trim())) return setLocalError(pre.errors.selfMeasureIncomplete);
        setLocalError(undefined);
        submit({
          screen: "size",
          size: mode === "unknown" ? { mode } : { mode, widthCm: toCm(size.w), heightCm: toCm(size.h), depthCm: toCm(size.d) },
        });
      }}
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={self ? pre.selfMeasure.title : w.size.title} lead={self ? pre.selfMeasure.lead : w.size.lead} />
      {self ? (
        <SelfMeasureGuide />
      ) : (
        <RadioCards
          label={w.size.modeLabel}
          name="sizeMode"
          value={mode}
          onChange={(v) => setMode(v === "known" ? "known" : "unknown")}
          columns={2}
          options={[
            { value: "unknown", label: w.size.unknown, description: w.size.unknownHint },
            { value: "known", label: w.size.known, description: w.size.knownHint },
          ]}
        />
      )}
      {mode === "known" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
          {field("w", w.size.width, true)}
          {field("h", w.size.height, self)}
          {field("d", w.size.depth, self)}
        </div>
      )}
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 5. Фото и описание ──────────────────────────────────────────────────────

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
      errors={errors}
      onSubmit={save}
      actions={
        <>
          {!props.selfMeasure && <SkipButton pending={pending || busy} onClick={save} />}
          <NextButton pending={pending || busy} />
        </>
      }
    >
      <StepHeading title={r.title} lead={props.selfMeasure ? pre.selfMeasure.roomHint : r.lead} />
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

// ─── 6. Где и когда ──────────────────────────────────────────────────────────

export type PlaceInitial = { city: string; address: string; desiredDate: string };

export function PlaceStep(props: StepBase & { initial: PlaceInitial }) {
  const { submit, pending, error, errors } = useStep(props);
  const [form, setForm] = useState(props.initial);
  const set = (patch: Partial<PlaceInitial>) => setForm({ ...form, ...patch });
  const p = w.place;
  return (
    <StepForm
      errors={errors}
      onSubmit={() => submit({ screen: "place", city: form.city, address: form.address, desiredDate: form.desiredDate || null })}
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={p.title} lead={p.lead} />
      <Input label={p.city} value={form.city} autoComplete="address-level2" maxLength={LIMITS.city} onChange={(e) => set({ city: e.target.value })} error={first(errors, "city")} />
      <Input
        label={p.address}
        hint={p.addressHint}
        value={form.address}
        autoComplete="street-address"
        maxLength={LIMITS.address}
        onChange={(e) => set({ address: e.target.value })}
        error={first(errors, "address")}
      />
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
