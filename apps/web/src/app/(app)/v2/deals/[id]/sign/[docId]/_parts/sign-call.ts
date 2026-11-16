import { failureOf } from "@/kit";
import type { ActionResult } from "@/platform/action";
import { logger } from "@/platform/logger";

/** Что сделать с ответом действия: успех — данные; уход (вход, согласие, карточка) — уже начат; отказ — текст (и поле). */
export type Handled<T> = { kind: "ok"; data: T } | { kind: "leaving" } | { kind: "error"; error: string; field?: string };

/** Занятость шага подписи: пока вызов идёт, повторное нажатие не уходит. */
export type Gate = { current: boolean };

/**
 * Один вызов действия подписи (чистая часть шагов «от руки» и ЭЦП, без React). Пока идёт прошлый вызов — новый не уходит
 * (`null`). Ответ разбирает `handle`. Отклонённый промис (обрыв сети, сбой сервера) — не исключение, а отказ с текстом
 * сбоя связи (`failureOf`): кнопка снова доступна, нарисованная подпись и выбранный способ остаются на экране, повтор
 * безопасен — сервер на повторную подпись отвечает тем же успехом (actions.ts, `repeated`). `redirect()` в действии —
 * уход. Занятость снимается только при отказе; при успехе и уходе её держит или снимает вызывающий (подпись от руки ждёт
 * смены шага, а начало ЭЦП освобождает сразу).
 */
export async function attempt<T>(
  gate: Gate,
  call: () => Promise<ActionResult<T>>,
  handle: (result: ActionResult<T>) => Handled<T>,
  online?: boolean,
): Promise<Handled<T> | null> {
  if (gate.current) return null;
  gate.current = true;
  let out: Handled<T>;
  try {
    out = handle(await call());
  } catch (error) {
    const text = failureOf(error, online);
    if (text === null) return { kind: "leaving" };
    logger.warn("app.sign: action failed", { error });
    out = { kind: "error", error: text };
  }
  if (out.kind === "error") gate.current = false;
  return out;
}
