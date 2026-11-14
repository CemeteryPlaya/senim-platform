import type { DealStatus } from "@/generated/prisma/enums";
import type { GeoFix, GeolocationError } from "./request-location";

/**
 * Чистые правила сдачи работы мастером: состояние запроса места, итог мягкой GPS-проверки, предупреждение «сдано далеко».
 * Только вычисления: тексты у экрана (v1 — ru.deal.ready, v2 — ru.app).
 */

/** Состояние запроса места на экране сдачи (хук держит экран). */
export type GeolocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "located"; fix: GeoFix }
  | { status: "failed"; error: GeolocationError };

/** Расстояние сдачи до адреса заказа, как его отдаёт сделка. */
export type ReadyGps = { distanceM: number | null; withinRadius: boolean | null; radiusM: number };

/** Итог мягкой проверки: без координат, у адреса, дальше радиуса. Дальше радиуса — предупреждение, не запрет. */
export type GpsVerdict = { kind: "unknown" } | { kind: "ok"; distanceM: number } | { kind: "far"; distanceM: number; radiusM: number };

export function gpsVerdict(r: ReadyGps): GpsVerdict {
  if (r.distanceM === null) return { kind: "unknown" };
  return r.withinRadius ? { kind: "ok", distanceM: r.distanceM } : { kind: "far", distanceM: r.distanceM, radiusM: r.radiusM };
}

/**
 * Мастер только что сдал работу дальше радиуса: «Что дальше» говорит об этом сразу. Данные для текста или null.
 * Сдача не блокируется — расстояние попадает в акт.
 */
export function readyFarInfo(d: { viewer: "CLIENT" | "EXECUTOR" | "OPERATOR"; status: DealStatus; ready: ReadyGps | null }): { distanceM: number; radiusM: number } | null {
  const r = d.ready;
  if (d.viewer !== "EXECUTOR" || d.status !== "READY" || !r || r.withinRadius !== false || r.distanceM === null) return null;
  return { distanceM: r.distanceM, radiusM: r.radiusM };
}

/** Чего ждём под «Сдать работу» (aria-live): фото, место или ничего; ошибка места — её код, сдача идёт и так. */
export type ReadyWait = { kind: "none" } | { kind: "photos" } | { kind: "locating" } | { kind: "geoFailed"; error: GeolocationError };

export function readyWait(s: { uploading: boolean; geo: GeolocationState }): ReadyWait {
  if (s.uploading) return { kind: "photos" };
  if (s.geo.status === "locating") return { kind: "locating" };
  return s.geo.status === "failed" ? { kind: "geoFailed", error: s.geo.error } : { kind: "none" };
}
