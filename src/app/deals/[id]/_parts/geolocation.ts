/**
 * Геолокация браузера при сдаче работы (ТЗ п. 7, решение 2.2.5): мягкая проверка — нет ответа, отказ или нет
 * API — сдача всё равно идёт, без координат. Расстояние до адреса считает сервер (deal-core.submitReady).
 * INTEGRATOR: заменить на общий помощник `_components/geolocation/` от platform-агента, когда он появится.
 */

export type GeoPoint = { lat: number; lng: number; accuracyM: number };
export type GeoSource = Pick<Geolocation, "getCurrentPosition">;

/** Предел точности во входе submitReadySchema. */
const MAX_ACCURACY_M = 100_000;

const browserGeo = (): GeoSource | undefined => (typeof navigator === "undefined" ? undefined : navigator.geolocation);

export function currentPosition(geo: GeoSource | undefined = browserGeo(), timeoutMs = 10_000): Promise<GeoPoint | null> {
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (p: GeoPoint | null) => {
      clearTimeout(timer);
      resolve(p);
    };
    geo.getCurrentPosition(
      (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.min(Math.round(pos.coords.accuracy), MAX_ACCURACY_M) }),
      () => done(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
