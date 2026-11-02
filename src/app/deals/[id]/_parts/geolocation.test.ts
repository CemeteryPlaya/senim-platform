import { describe, expect, it } from "vitest";
import { currentPosition, type GeoSource } from "./geolocation";

const fix = { coords: { latitude: 43.2389, longitude: 76.8897, accuracy: 18.6 } } as GeolocationPosition;
const geo = (answer: "ok" | "denied" | "hang"): GeoSource => ({
  getCurrentPosition: (ok, err) => {
    if (answer === "ok") ok(fix);
    if (answer === "denied") err?.({ code: 1 } as GeolocationPositionError);
  },
});

describe("геолокация при сдаче работы — мягкая: без неё сдать можно", () => {
  it("браузер дал координаты — широта, долгота и точность в целых метрах", async () => {
    await expect(currentPosition(geo("ok"))).resolves.toEqual({ lat: 43.2389, lng: 76.8897, accuracyM: 19 });
  });

  it("человек запретил доступ — null, а не ошибка", async () => {
    await expect(currentPosition(geo("denied"))).resolves.toBeNull();
  });

  it("браузер молчит — null по таймауту", async () => {
    await expect(currentPosition(geo("hang"), 10)).resolves.toBeNull();
  });

  it("геолокации в браузере нет — null", async () => {
    await expect(currentPosition(undefined)).resolves.toBeNull();
  });
});
