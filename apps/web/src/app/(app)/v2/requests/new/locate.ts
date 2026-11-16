import { GeolocationError, requestLocation, type RequestLocationOptions } from "@/features/delivery/request-location";
import { ru } from "@/i18n/ru";
import type { GeoPoint } from "@/modules/requests/client";

const t = ru.app.requests.wizard.place;

export type LocateResult = { point: GeoPoint; accuracyM: number } | { error: string };

/**
 * «Моё местоположение» на шаге адреса: место устройства общим помощником (`requestLocation` — тот же, что у сдачи работы:
 * https, ожидание ответа на запрос разрешения, понятные коды отказа) и текст экрана v2 по коду. Свежесть — без кэша
 * браузера: человек указывает адрес, где стоит сейчас.
 */
export async function locateDevice(options: RequestLocationOptions = {}): Promise<LocateResult> {
  try {
    const fix = await requestLocation({ maxAgeMs: 0, ...options });
    return { point: { lat: fix.lat, lng: fix.lng }, accuracyM: Math.round(fix.accuracyM) };
  } catch (e) {
    return { error: e instanceof GeolocationError && e.code === "denied" ? t.pointDenied : t.pointUnavailable };
  }
}
