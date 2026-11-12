"use client";

import { useCallback, useRef, useState } from "react";
import { GeolocationError, requestLocation, type GeoFix, type RequestLocationOptions } from "./request-location";

export type GeolocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "located"; fix: GeoFix }
  | { status: "failed"; error: GeolocationError };

/**
 * Хук для экрана: request() по нажатию кнопки, состояние — для подписи и текста ошибки.
 * Повторное нажатие во время определения не запускает второй запрос.
 */
export function useGeolocation(options?: RequestLocationOptions) {
  const [state, setState] = useState<GeolocationState>({ status: "idle" });
  const pending = useRef<Promise<GeoFix | null> | null>(null);

  const request = useCallback((): Promise<GeoFix | null> => {
    if (pending.current) return pending.current;
    setState({ status: "locating" });
    const run = requestLocation(options)
      .then((fix) => {
        setState({ status: "located", fix });
        return fix;
      })
      .catch((e: unknown) => {
        setState({ status: "failed", error: e instanceof GeolocationError ? e : new GeolocationError("unavailable") });
        return null;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = run;
    return run;
  }, [options]);

  return { state, request };
}
