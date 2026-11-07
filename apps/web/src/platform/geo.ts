/**
 * Геометрия на сфере для мягкой проверки GPS при сдаче работы (ТЗ п. 7): расстояние от точки мастера
 * до адреса заказа. Чистые функции без ввода-вывода.
 */

export type GeoPoint = { lat: number; lng: number };

/** Средний радиус Земли (IUGG), метры. */
const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние по большому кругу (формула гаверсинусов), метры. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GpsCheck =
  /** Есть обе точки: расстояние (целые метры) и признак «в радиусе». */
  | { distanceM: number; withinRadius: boolean }
  /** Нет координат мастера или адреса: проверить нечем, сдача не блокируется. */
  | { distanceM: null; withinRadius: null };

/** Мягкая проверка: дальше радиуса — предупреждение, а не запрет; решает вызывающий. */
export function checkGps(target: GeoPoint | null, point: GeoPoint | null, radiusM: number): GpsCheck {
  if (!target || !point) return { distanceM: null, withinRadius: null };
  const distanceM = Math.round(haversineMeters(target, point));
  return { distanceM, withinRadius: distanceM <= radiusM };
}
