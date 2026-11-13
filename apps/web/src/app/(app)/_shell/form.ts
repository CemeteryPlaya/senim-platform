"use client";

import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import type { ActionResult } from "@/platform/action";
import { logger } from "@/platform/logger";
import { safeLocalPath, to } from "./paths";

/** Где человек сейчас: путь и строка запроса (в браузере — `window.location`). */
export type Here = { pathname: string; search: string };

/** Что делать с ответом действия. */
export type Outcome<T> =
  | { kind: "success"; data: T }
  | { kind: "leave"; href: string }
  | { kind: "error"; error: string; fieldErrors: Record<string, string> };

/** Адрес экрана v2 с возвратом сюда же: `next` — только путь этого сайта (safeLocalPath). */
function withNext(screen: string, here: Here): string {
  const next = safeLocalPath(here.pathname + here.search);
  return next === "/" ? to(screen) : `${to(screen)}?${new URLSearchParams({ next })}`;
}

/**
 * Ответ Server Action → что делать форме (чистая функция, без React и браузера).
 *
 * Те же коды, что у `leaveIfSignedOut` в v1: UNAUTHENTICATED (сессия истекла посреди формы) — на вход v2, CONSENT_REQUIRED
 * (сменилась редакция согласия) — на экран согласия v2; оба — с возвратом на текущий экран. Прочие ошибки остаются
 * на экране: общий текст и по первому сообщению на каждое поле.
 */
export function outcomeOf<T>(result: ActionResult<T>, here: Here): Outcome<T> {
  if (result.ok) return { kind: "success", data: result.data };
  if (result.code === "UNAUTHENTICATED") return { kind: "leave", href: withNext("/login", here) };
  if (result.code === "CONSENT_REQUIRED") return { kind: "leave", href: withNext("/consent", here) };
  const fieldErrors: Record<string, string> = {};
  for (const [name, messages] of Object.entries(result.fieldErrors ?? {})) {
    if (messages[0] !== undefined) fieldErrors[name] = messages[0];
  }
  return { kind: "error", error: result.error, fieldErrors };
}

/** Поля формы → простой объект для Server Action (схему и разбор значений держит `action()` на сервере). */
export function formDataToInput(data: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(data.entries());
}

export type UseActionFormOptions<I, T> = {
  /** Вызывается с данными успешного ответа. */
  onSuccess?: (data: T) => void;
  /** Как собрать вход действия из формы; по умолчанию — поля формы как есть (`formDataToInput`). */
  toInput?: (data: FormData) => I;
};

export type ActionForm = {
  pending: boolean;
  /** Общая ошибка формы (текст из ответа сервера) или `null`. */
  error: string | null;
  /** Первое сообщение по каждому полю — в `error` соответствующего поля kit. */
  fieldErrors: Record<string, string>;
  submit: (data: FormData) => Promise<void>;
};

/**
 * Состояние формы с Server Action, созданным через `action()` из `@/platform/action`.
 *
 * `submit(formData)` — для `<form action={submit}>`: повторная отправка, пока идёт прошлая, игнорируется. «Сессия
 * истекла» и «нужно согласие» уводят на экран v2 с возвратом (см. `outcomeOf`) и состояния формы не меняют. Сбой
 * транспорта (сеть, сервер) — общая ошибка из `ru.common.errors.generic`, подробности в журнале.
 *
 * `toInput` по умолчанию не проверяет типы: вход действия — «сырой» объект полей, а разбирает и проверяет его
 * схема действия на сервере (первая строка `action()`).
 */
export function useActionForm<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: UseActionFormOptions<I, T> = {},
): ActionForm {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const { onSuccess, toInput } = options;

  async function submit(data: FormData): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      // Вход проверяет схема действия на сервере, поэтому приведение типа здесь безопасно.
      const input = toInput ? toInput(data) : (formDataToInput(data) as I);
      const outcome = outcomeOf(await action(input), window.location);
      if (outcome.kind === "success") onSuccess?.(outcome.data);
      else if (outcome.kind === "leave") window.location.assign(outcome.href);
      else {
        setError(outcome.error);
        setFieldErrors(outcome.fieldErrors);
      }
    } catch (e) {
      logger.warn("app.form: action failed", { error: e });
      setError(ru.common.errors.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return { pending, error, fieldErrors, submit };
}
