"use client";

import { LocateFixed, MapPin } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { LIMITS, type GeoPoint } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Button, Input, Textarea } from "@/ui";
import { Uploader } from "@/app/_components/uploader";
import { locateAddressAction } from "../actions";
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

export type PlaceInitial = { city: string; address: string; desiredDate: string; location: GeoPoint | null };

type LocateState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "gps"; accuracyM: number }
  | { kind: "geocoded"; precision: "address" | "city" }
  | { kind: "error"; message: string };

const coords = (p: GeoPoint) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/**
 * Точка адреса (решение 2.2.5): «Указать моё местоположение» (геолокация браузера, с точностью в метрах) или
 * «Найти по адресу» (геокодер за интерфейсом, сейчас мок). Отказ в доступе — понятное сообщение; адрес
 * сохраняется и без точки. Точку и адрес мастер увидит только после оферты.
 */
function LocationField({ value, onChange, city, address }: { value: GeoPoint | null; onChange: (p: GeoPoint | null) => void; city: string; address: string }) {
  const l = w.place.location;
  const [state, setState] = useState<LocateState>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setState({ kind: "error", message: l.unsupported });
    setState({ kind: "busy" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState({ kind: "gps", accuracyM: Math.round(pos.coords.accuracy) });
      },
      (err) => setState({ kind: "error", message: err.code === err.PERMISSION_DENIED ? l.denied : l.unavailable }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const geocode = () =>
    startTransition(async () => {
      setState({ kind: "busy" });
      const result = await locateAddressAction({ city, address });
      if (!result.ok) return setState({ kind: "error", message: result.error });
      if (!result.data) return setState({ kind: "error", message: l.notFound });
      onChange({ lat: result.data.lat, lng: result.data.lng });
      setState({ kind: "geocoded", precision: result.data.precision });
    });

  const status =
    state.kind === "error"
      ? state.message
      : state.kind === "gps"
        ? l.accuracy(state.accuracyM)
        : state.kind === "geocoded" && state.precision === "city"
          ? l.cityOnly
          : null;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-lg font-bold text-ink">{l.title}</legend>
      <p className="text-base text-ink-soft">{l.hint}</p>
      {value && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-ink">
          <MapPin aria-hidden className="size-5 shrink-0 text-primary" />
          <span>{l.set(coords(value))}</span>
          <Button
            variant="ghost"
            onClick={() => {
              onChange(null);
              setState({ kind: "idle" });
            }}
          >
            {l.clear}
          </Button>
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="secondary" loading={state.kind === "busy"} icon={<LocateFixed />} onClick={locate}>
          {l.locate}
        </Button>
        <Button variant="ghost" disabled={state.kind === "busy" || city.trim().length < 2} onClick={geocode}>
          {l.byAddress}
        </Button>
      </div>
      <p role="status" className="text-base text-ink-soft">
        {status}
      </p>
    </fieldset>
  );
}

export function PlaceStep(props: StepBase & { initial: PlaceInitial }) {
  const { submit, pending, error, errors } = useStep(props);
  const [form, setForm] = useState(props.initial);
  // Функциональное обновление: точка от геокодера приходит позже и не должна стереть то, что ввели за это время.
  const set = (patch: Partial<PlaceInitial>) => setForm((f) => ({ ...f, ...patch }));
  const p = w.place;
  return (
    <StepForm
      title={p.title}
      lead={p.lead}
      frame={props.frame}
      errors={errors}
      onSubmit={() => submit({ screen: "place", city: form.city, address: form.address, desiredDate: form.desiredDate || null, location: form.location })}
      actions={<NextButton pending={pending} />}
    >
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
      <LocationField value={form.location} onChange={(location) => set({ location })} city={form.city} address={form.address} />
      <Input
        label={p.desiredDate}
        hint={p.desiredDateHint}
        type="date"
        optional
        value={form.desiredDate}
        onChange={(e) => set({ desiredDate: e.target.value })}
        error={first(errors, "desiredDate")}
      />
      <FormError message={error ?? first(errors, "location")} />
    </StepForm>
  );
}
