import type { GeolocationState } from "@/features/delivery/gps";
import type { GeoErrorCode } from "@/features/delivery/request-location";
import { ru } from "@/i18n/ru";

const t = ru.app.masterSteps.ready;
const p = t.place;

/** Сколько фото сдачи принимает модуль (`submitReadySchema`: от 1 до 12). */
export const MAX_PHOTOS = 12;

/**
 * Состояние «Места сдачи» на экране: не запрошено, ждём, отмечено, отказ в доступе, таймаут, место не определилось,
 * геолокации нет (страница не по https или браузер её не умеет). Координаты цифрами не показываются.
 */
export type PlaceKind = "idle" | "locating" | "located" | "denied" | "timeout" | "unavailable" | "unsupported";

export type PlaceView = {
  kind: PlaceKind;
  /** Строка о месте (объявляется диктору при смене). */
  text: string;
  /** Подпись кнопки запроса; `null` — кнопки нет (геолокации нет совсем). Во время запроса кнопка ждёт. */
  button: string | null;
};

const FAILED: Record<GeoErrorCode, PlaceKind> = {
  denied: "denied",
  timeout: "timeout",
  unavailable: "unavailable",
  // Нет https или нет API: повторное нажатие ничего не изменит — кнопки нет, сдаём без места.
  unsupported: "unsupported",
  insecure: "unsupported",
};

/** Вид «Места сдачи» по состоянию запроса геолокации. */
export function placeView(state: GeolocationState): PlaceView {
  switch (state.status) {
    case "idle":
      return { kind: "idle", text: p.idle, button: p.mark };
    case "locating":
      return { kind: "locating", text: p.locating, button: p.mark };
    case "located":
      return { kind: "located", text: p.located, button: p.again };
    case "failed": {
      const kind = FAILED[state.error.code];
      return { kind, text: p[kind], button: kind === "unsupported" ? null : p.retry };
    }
  }
}

export type ReadyInput = { dealId: string; photoIds: string[]; lat?: number; lng?: number; accuracyM?: number };

/** Вход «Сдать работу»: фото и — только если место отмечено — координаты с точностью. Без места сдача тоже идёт. */
export function readyInput(dealId: string, photoIds: readonly string[], state: GeolocationState): ReadyInput {
  const base = { dealId, photoIds: [...photoIds] };
  if (state.status !== "located") return base;
  const { lat, lng, accuracyM } = state.fix;
  return { ...base, lat, lng, accuracyM };
}

/** Итог мягкой проверки модуля после сдачи (`ReadyResult`): тост на карточке — обычный или «сдано далеко». */
export function doneToast(result: { distanceM: number | null; withinRadius: boolean | null; radiusM: number }): { text: string; far: boolean } {
  if (result.withinRadius === false && result.distanceM !== null) return { text: t.doneFar(String(result.distanceM), String(result.radiusM)), far: true };
  return { text: t.done, far: false };
}
