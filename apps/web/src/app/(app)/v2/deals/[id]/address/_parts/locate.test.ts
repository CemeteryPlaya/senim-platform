import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { locateDevice } from "./locate";

const t = ru.app.deal.address;

/** Браузерная геолокация-заглушка: успех с точкой или отказ с кодом браузера (1 — запрет, 2 — нет места). */
const geo = (result: { lat: number; lng: number; accuracy: number } | { code: 1 | 2 | 3 }): Pick<Geolocation, "getCurrentPosition"> => ({
  getCurrentPosition: (ok, fail) => {
    if ("lat" in result) ok({ coords: { latitude: result.lat, longitude: result.lng, accuracy: result.accuracy } } as GeolocationPosition);
    else fail?.({ code: result.code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError);
  },
});

describe("«Моё местоположение» на экране адреса сделки — общим помощником геолокации", () => {
  it("место определилось — точка и точность в метрах", async () => {
    expect(await locateDevice({ geolocation: geo({ lat: 51.12, lng: 71.43, accuracy: 18.6 }), secureContext: true })).toEqual({
      point: { lat: 51.12, lng: 71.43 },
      accuracyM: 19,
    });
  });

  it("запрет доступа — текст «разрешите доступ»; нет места, не https, нет геолокации — «не удалось определить»", async () => {
    expect(await locateDevice({ geolocation: geo({ code: 1 }), secureContext: true })).toEqual({ error: t.pointDenied });
    expect(await locateDevice({ geolocation: geo({ code: 2 }), secureContext: true })).toEqual({ error: t.pointUnavailable });
    expect(await locateDevice({ geolocation: geo({ lat: 1, lng: 1, accuracy: 1 }), secureContext: false })).toEqual({ error: t.pointUnavailable });
    expect(await locateDevice({ geolocation: null, secureContext: true })).toEqual({ error: t.pointUnavailable });
  });
});
