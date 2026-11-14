"use client";

import { useCallback, useRef, useState } from "react";
import type { GeolocationState } from "@/features/delivery/gps";
import { GeolocationError, requestLocation, type GeoFix, type RequestLocationOptions } from "@/features/delivery/request-location";

/**
 * Место устройства для экранов v2 (сдача работы): `request()` — только по нажатию (иначе браузер может не показать запрос
 * разрешения), состояние — для строки экрана. Таймауты и коды ошибок — `requestLocation` из features (как в v1); текст
 * экран берёт по `error.code` из своих текстов (`GeolocationError.message` — текст v1, здесь не используется).
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
