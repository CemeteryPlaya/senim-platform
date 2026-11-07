import { afterEach, describe, expect, it, vi } from "vitest";
import { GeolocationError, requestLocation } from "./request-location";

afterEach(() => vi.useRealTimers());

type Success = Parameters<Geolocation["getCurrentPosition"]>[0];
type Failure = NonNullable<Parameters<Geolocation["getCurrentPosition"]>[1]>;

/** Поддельный navigator.geolocation: отвечает по сценарию теста. */
const fakeGeo = (answer: (ok: Success, fail: Failure, options?: PositionOptions) => void) => ({
  getCurrentPosition: vi.fn((ok: Success, fail?: Failure | null, options?: PositionOptions) => answer(ok, fail!, options)),
});
const position = (latitude: number, longitude: number, accuracy: number) => ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;
const failure = (code: number) => ({ code }) as GeolocationPositionError;

const rejection = async (p: Promise<unknown>) => {
  const e = await p.catch((err: unknown) => err);
  return e instanceof GeolocationError ? { code: e.code, message: e.message } : e;
};

describe("requestLocation", () => {
  it("место устройства: широта, долгота и точность в целых метрах; высокая точность и свежесть минута", async () => {
    const geolocation = fakeGeo((ok) => ok(position(51.128207, 71.430411, 12.6)));
    expect(await requestLocation({ geolocation, secureContext: true })).toEqual({ lat: 51.128207, lng: 71.430411, accuracyM: 13 });
    expect(geolocation.getCurrentPosition.mock.calls[0]![2]).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  });

  it.each([
    [1, "denied", /запрещён/],
    [2, "unavailable", /Не удалось определить/],
    [3, "timeout", /слишком долго/],
  ])("ошибка браузера %i — %s с понятным текстом", async (code, expected, text) => {
    const geolocation = fakeGeo((_ok, fail) => fail(failure(code)));
    expect(await rejection(requestLocation({ geolocation, secureContext: true }))).toMatchObject({ code: expected, message: expect.stringMatching(text) });
  });

  it("нет API или страница не по https — понятная ошибка без вызова браузера", async () => {
    const geolocation = fakeGeo(() => undefined);
    expect(await rejection(requestLocation({ geolocation: null, secureContext: true }))).toMatchObject({ code: "unsupported" });
    expect(await rejection(requestLocation({ geolocation, secureContext: false }))).toMatchObject({ code: "insecure" });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("браузер молчит (запрос разрешения проигнорирован) — таймаут, а не вечное ожидание; поздний ответ не меняет итог", async () => {
    vi.useFakeTimers();
    let late: Success | null = null;
    const pending = requestLocation({ geolocation: fakeGeo((ok) => (late = ok)), secureContext: true, timeoutMs: 1_000 });
    const result = rejection(pending);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await result).toMatchObject({ code: "timeout" });
    late!(position(1, 2, 3));
  });
});
