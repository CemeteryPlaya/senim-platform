import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ru } from "@/i18n/ru";

/** Знает ли браузер, что сеть есть (на сервере — да). */
const browserOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine;

/**
 * Текст сбоя связи для действия, вызванного вручную (окно подтверждения, подпись): промис Server Action отклонён — запрос
 * не дошёл до сервера или ответ не вернулся (обрыв сети, сбой сервера). Отказ сервера по существу сюда не попадает: он
 * приходит результатом с текстом. Браузер знает, что сети нет (`navigator.onLine === false`), — «Нет связи»; иначе —
 * «Не удалось отправить». Чистая функция: состояние сети передаётся аргументом (по умолчанию — из браузера).
 */
export function networkFailureText(online: boolean = browserOnline()): string {
  return online ? ru.app.kit.network.failed : ru.app.kit.network.offline;
}

/**
 * Что показать человеку, когда вызов действия бросил исключение: текст сбоя связи — или `null`, если это уход со страницы
 * (`redirect()` в Server Action: Next уже ведёт на новый адрес; ошибки нет, кнопка остаётся занятой до ухода).
 */
export function failureOf(error: unknown, online: boolean = browserOnline()): string | null {
  return isRedirectError(error) ? null : networkFailureText(online);
}
