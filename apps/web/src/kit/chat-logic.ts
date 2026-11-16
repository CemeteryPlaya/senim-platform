/** Чистая логика переписки (Chat, ChatComposer): без React и браузера, проверяется юнит-тестами. */

type Device = "mobile" | "desktop";

/**
 * Что делает нажатие клавиши в поле сообщения. На компьютере Enter отправляет, Shift+Enter — перенос строки;
 * на телефоне Enter — всегда перенос (отправляет кнопка). Нажатие во время ввода через IME (`isComposing`) — не наше.
 */
export function composerKeyAction(event: { key: string; shiftKey: boolean; isComposing: boolean }, device: Device): "send" | "default" {
  if (event.key !== "Enter" || event.isComposing) return "default";
  if (device === "desktop" && !event.shiftKey) return "send";
  return "default";
}

/** Счётчик у поля показывается, когда введено не меньше 80% от предела (и предел задан). */
export function counterVisible(length: number, maxLength: number | undefined): boolean {
  return maxLength !== undefined && maxLength > 0 && length >= Math.ceil(maxLength * 0.8);
}

/** Можно ли отправить: есть текст кроме пробелов (или `allowEmpty` — к сообщению приложено фото), не больше предела, не идёт отправка. */
export function canSend(text: string, maxLength: number | undefined, pending: boolean, allowEmpty = false): boolean {
  if (pending) return false;
  if (text.trim().length === 0 && !allowEmpty) return false;
  return maxLength === undefined || text.length <= maxLength;
}

/**
 * Прокручивать ли ленту к последнему сообщению. При первом показе — всегда; при новом сообщении — если человек был
 * внизу (не мешаем читать историю выше) или это его собственное сообщение. Без нового сообщения — нет.
 */
export function shouldFollow(input: {
  previousLastId: string | undefined;
  lastId: string | undefined;
  lastIsMine: boolean;
  wasAtBottom: boolean;
  firstRender: boolean;
}): boolean {
  if (input.lastId === undefined) return false;
  if (input.firstRender) return true;
  if (input.lastId === input.previousLastId) return false;
  return input.wasAtBottom || input.lastIsMine;
}
