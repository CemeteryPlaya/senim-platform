"use client";

import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, CityField, Explain, HiddenField, Stack, TextField } from "@/kit";
import { LIMITS, SUGGESTED_CITIES, type GeoPoint } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../_shell/form";
import { locateAddressAction } from "./actions";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";
import { addDays, todayAstana } from "./steps";
import { useStepMemory } from "./wizard-memory";

const t = ru.app.requests.wizard.place;

export type PlaceInitial = { city: string; address: string; desiredDate: string; location: GeoPoint | null };

/** Что сейчас с точкой: найдена (как и с какой точностью), ищется, не найдена. */
type PointState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "gps"; accuracyM: number }
  | { kind: "geocoded"; precision: "address" | "city" }
  | { kind: "error"; message: string };

function pointStatus(point: GeoPoint | null, state: PointState): string | null {
  switch (state.kind) {
    case "error":
      return state.message;
    case "gps":
      return t.pointAccuracy(state.accuracyM);
    case "geocoded":
      return state.precision === "city" ? t.pointCity : t.pointSet;
    case "idle":
    case "busy":
      return point ? t.pointSet : null;
  }
}

/**
 * Точка адреса (необязательна): «Найти по адресу» — геокодер модуля (сейчас мок: только центр города), «Моё
 * местоположение» — геолокация браузера с точностью в метрах. Карты нет. Отказ — понятная строка; адрес сохраняется и
 * без точки. Найденная точка уходит скрытыми полями `lat` / `lng`.
 */
function PointField({ value, onChange, city, address, device }: { value: GeoPoint | null; onChange: (p: GeoPoint | null) => void; city: string; address: string; device: Device }) {
  const [state, setState] = useState<PointState>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return setState({ kind: "error", message: t.pointUnavailable });
    setState({ kind: "busy" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState({ kind: "gps", accuracyM: Math.round(pos.coords.accuracy) });
      },
      (err) => setState({ kind: "error", message: err.code === err.PERMISSION_DENIED ? t.pointDenied : t.pointUnavailable }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const geocode = () => {
    if (city.trim().length < 2) return setState({ kind: "error", message: t.cityFirst });
    startTransition(async () => {
      setState({ kind: "busy" });
      const outcome = outcomeOf(await locateAddressAction({ city, address }), window.location);
      if (outcome.kind === "leave") return window.location.assign(outcome.href);
      if (outcome.kind === "error") return setState({ kind: "error", message: outcome.error });
      if (!outcome.data) return setState({ kind: "error", message: t.pointNotFound });
      onChange({ lat: outcome.data.lat, lng: outcome.data.lng });
      setState({ kind: "geocoded", precision: outcome.data.precision });
    });
  };

  const busy = state.kind === "busy";
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sub font-medium text-ink">{t.pointLegend}</legend>
      <div>
        <Explain label={t.pointExplain.label} title={t.pointExplain.title} device={device}>
          <p>{t.pointExplain.body}</p>
        </Explain>
      </div>
      {value && (
        <>
          <HiddenField name="lat" value={String(value.lat)} />
          <HiddenField name="lng" value={String(value.lng)} />
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" pending={busy} onClick={geocode}>
          {t.findPoint}
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={locate}>
          {t.locate}
        </Button>
        {value && (
          <Button
            variant="quiet"
            size="sm"
            disabled={busy}
            onClick={() => {
              onChange(null);
              setState({ kind: "idle" });
            }}
          >
            {t.clearPoint}
          </Button>
        )}
      </div>
      <p role="status" className="text-sub text-muted">
        {pointStatus(value, state)}
      </p>
    </fieldset>
  );
}

/** Шаг 4 «Где и когда?»: город, адрес (его увидит только мастер, с которым договоритесь), точка и желаемая дата. */
export function WizardPlace({ base, device, initial }: { base: WizardBase; device: Device; initial: PlaceInitial }) {
  const form = useWizardStep("place", base);
  // Несохранённый ввод шага переживает «Назад» и перезагрузку (sessionStorage).
  const [place, setPlace] = useStepMemory(base.draftId, "place", initial);
  // Функциональное обновление: точка от геокодера приходит позже и не должна стереть то, что ввели за это время.
  const set = (patch: Partial<PlaceInitial>) => setPlace((p) => ({ ...p, ...patch }));
  const e = form.errors;
  // Сегодня по Астане: раньше желаемую дату выбрать нельзя; быстрые сроки считаются от этого дня.
  const [today] = useState(() => todayAstana());
  const quick = [
    { label: t.quickDates.month, date: addDays(today, 30) },
    { label: t.quickDates.twoMonths, date: addDays(today, 60) },
    { label: t.quickDates.noRush, date: "" },
  ];
  return (
    <WizardFrame base={base} title={t.title} lead={t.lead} form={form}>
      <Stack>
        <CityField label={t.city} name="city" suggestions={SUGGESTED_CITIES} maxLength={LIMITS.city} value={place.city} onChange={(city) => set({ city })} error={e.city} />
        <TextField
          label={t.address}
          name="address"
          autoComplete="street-address"
          maxLength={LIMITS.address}
          value={place.address}
          onChange={(ev) => set({ address: ev.target.value })}
          error={e.address}
        />
      </Stack>
      <PointField value={place.location} onChange={(location) => set({ location })} city={place.city} address={place.address} device={device} />
      {e.location && (
        <p role="alert" className="text-sub text-danger">
          {e.location}
        </p>
      )}
      <Stack>
        <TextField label={t.date} name="desiredDate" type="date" min={today} value={place.desiredDate} onChange={(ev) => set({ desiredDate: ev.target.value })} error={e.desiredDate} />
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q.label} variant="secondary" size="sm" aria-pressed={place.desiredDate === q.date} onClick={() => set({ desiredDate: q.date })}>
              {q.label}
            </Button>
          ))}
        </div>
      </Stack>
    </WizardFrame>
  );
}
