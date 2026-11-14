import { gpsVerdict, readyFarInfo, readyWait, type GeolocationState, type ReadyGps } from "@/features/delivery/gps";
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
export function gpsNote(r: ReadyGps): GpsNote {
  const t = ru.deal.ready;
  const v = gpsVerdict(r);
  if (v.kind === "unknown") return { tone: "unknown", text: t.gpsUnknown };
  return v.kind === "ok" ? { tone: "ok", text: t.gpsOk(v.distanceM) } : { tone: "warning", text: t.gpsFar(v.distanceM, v.radiusM) };
}

/**
 * Мастер только что сдал работу дальше радиуса: «Что дальше» говорит об этом сразу (live), а не только
 * плашкой в разделе «Сдача» ниже. Сдача не блокируется — расстояние попадает в акт.
 */
export function readyFarWarning(d: { viewer: "CLIENT" | "EXECUTOR" | "OPERATOR"; status: DealStatus; ready: ReadyGps | null }): string | null {
  const far = readyFarInfo(d);
  return far ? ru.deal.ready.gpsWarning(far.distanceM, far.radiusM) : null;
}

/** Строка под «Сдать работу» (aria-live): ждём фото, определяем место или почему места не будет (сдача идёт и так). */
export function readyWaitText(s: { uploading: boolean; geo: GeolocationState }): string {
  const w = readyWait(s);
  if (w.kind === "photos") return ru.deal.ready.waitPhotos;
  if (w.kind === "locating") return ru.deal.ready.locating;
  return w.kind === "geoFailed" ? w.error.message : "";
}
