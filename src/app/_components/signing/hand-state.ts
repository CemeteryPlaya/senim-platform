import { ru } from "@/i18n/ru";

/** Рисунок с холста: canvas.toDataURL("image/png"). */
export const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

export type HandMode = "draw" | "type";
export type HandPayload = { imageDataUrl: string } | { typedName: string };

/**
 * Что отправить на сервер: рисунок, если на холсте есть штрихи, или напечатанное имя
 * (клавиатурная альтернатива для тех, кому рисовать неудобно или недоступно).
 */
export function handPayload(input: { mode: HandMode; hasInk: boolean; dataUrl: string | null; typedName: string }): { ok: true; payload: HandPayload } | { ok: false; error: string } {
  if (input.mode === "draw") {
    return input.hasInk && input.dataUrl ? { ok: true, payload: { imageDataUrl: input.dataUrl } } : { ok: false, error: ru.documents.hand.empty };
  }
  const name = input.typedName.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: ru.documents.errors.typedNameLength };
  return { ok: true, payload: { typedName: name } };
}
