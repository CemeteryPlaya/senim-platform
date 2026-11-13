import type { GeolocationState } from "@/app/(legacy)/_components/geolocation";
import type { DealStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";

/**
 * Чистые правила экрана сделки: главное фото, строка геолокации сдачи.
 * Без React — проверяются юнит-тестом.
 */

type Src = { src: string };

/** Главное фото: сдача, иначе последний отчёт «Хода работ» с фото, иначе фото помещения, иначе иллюстрация типа. */
export function heroImage(p: { ready: readonly Src[]; progress: readonly (readonly Src[])[]; room: readonly Src[]; illustration: string | null }): string | null {
  const report = p.progress.findLast((photos) => photos.length > 0);
  return p.ready[0]?.src ?? report?.[0]?.src ?? p.room[0]?.src ?? p.illustration;
}

export type GpsNote = { tone: "ok" | "warning" | "unknown"; text: string };

/** Мягкая проверка GPS: дальше радиуса — предупреждение (не запрет), без координат — так и пишем. */
export function gpsNote(r: { distanceM: number | null; withinRadius: boolean | null; radiusM: number }): GpsNote {
  const t = ru.deal.ready;
  if (r.distanceM === null) return { tone: "unknown", text: t.gpsUnknown };
  return r.withinRadius ? { tone: "ok", text: t.gpsOk(r.distanceM) } : { tone: "warning", text: t.gpsFar(r.distanceM, r.radiusM) };
}

type ReadyGps = { distanceM: number | null; withinRadius: boolean | null; radiusM: number };

/**
 * Мастер только что сдал работу дальше радиуса: «Что дальше» говорит об этом сразу (live), а не только
 * плашкой в разделе «Сдача» ниже. Сдача не блокируется — расстояние попадает в акт.
 */
export function readyFarWarning(d: { viewer: "CLIENT" | "EXECUTOR" | "OPERATOR"; status: DealStatus; ready: ReadyGps | null }): string | null {
  const r = d.ready;
  if (d.viewer !== "EXECUTOR" || d.status !== "READY" || !r || r.withinRadius !== false || r.distanceM === null) return null;
  return ru.deal.ready.gpsWarning(r.distanceM, r.radiusM);
}

/** Строка под «Сдать работу» (aria-live): ждём фото, определяем место или почему места не будет (сдача идёт и так). */
export function readyWaitText(s: { uploading: boolean; geo: GeolocationState }): string {
  if (s.uploading) return ru.deal.ready.waitPhotos;
  if (s.geo.status === "locating") return ru.deal.ready.locating;
  return s.geo.status === "failed" ? s.geo.error.message : "";
}
