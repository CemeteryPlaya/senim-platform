"use client";

import { useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { Button, Explain } from "@/kit";
import type { GeoPoint } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../../../_shell/form";
import { locateDealAddressAction } from "../actions";
import { locateDevice } from "./locate";

const t = ru.app.deal.address;

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
 * Точка адреса сделки (необязательна; перенесена из прежнего шага адреса заявки, ADR-016): «Найти по адресу» — геокодер
 * модуля requests (сейчас мок: только центр города), «Моё местоположение» — геолокация браузера с точностью в метрах.
 * Карты нет. Отказ — понятная строка; адрес сохраняется и без точки.
 */
export function PointField({ value, onChange, city, address, device }: { value: GeoPoint | null; onChange: (p: GeoPoint | null) => void; city: string; address: string; device: Device }) {
  const [state, setState] = useState<PointState>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const locate = async () => {
    setState({ kind: "busy" });
    const found = await locateDevice();
    if ("error" in found) return setState({ kind: "error", message: found.error });
    onChange(found.point);
    setState({ kind: "gps", accuracyM: found.accuracyM });
  };

  const geocode = () => {
    // Город сделки — из заявки (обязателен на её шаге «Где и когда»); без него геокодеру искать негде.
    if (city.trim().length < 2) return setState({ kind: "error", message: t.pointNotFound });
    startTransition(async () => {
      setState({ kind: "busy" });
      const outcome = outcomeOf(await locateDealAddressAction({ city, address }), window.location);
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
