"use client";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import type { ActionResult } from "@/platform/action";
import { logger } from "@/platform/logger";
import { ONBOARDING_SCREENS, safeLocalPath, to } from "./paths";

/** Где человек сейчас: путь и строка запроса (в браузере — `window.location`). */
export type Here = { pathname: string; search: string };

/** Что делать с ответом действия. */
export type Outcome<T> =
  | { kind: "success"; data: T }
  | { kind: "leave"; href: string }
  | { kind: "error"; error: string; fieldErrors: Record<string, string> };

/** Адрес экрана v2 с возвратом сюда же: `next` — только путь этого сайта (safeLocalPath). */
function withNext(screen: string, here: Here): string {
  // Уже на этом экране (вход, согласие): возврат на самого себя дал бы петлю — next опускается.
  if (here.pathname === to(screen)) return to(screen);
  // На экране первого шага (согласие, знакомство, почта) возврат — его собственный `next`: адрес самого шага вложил бы
  // `next` в `next`, и после шагов человек вернулся бы на пройденный шаг.
  const next = ONBOARDING_SCREENS.includes(here.pathname)
    ? safeLocalPath(new URLSearchParams(here.search).get("next") ?? "/")
    : safeLocalPath(here.pathname + here.search);
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

/**
 * Кнопка, которой отправили форму (`event.nativeEvent.submitter`): только `<button>` и `<input>`. Её `name=value`
 * попадает в поля формы, и сервер различает несколько кнопок отправки («Получить код», «Отправить ещё раз»).
 * Чистая функция: проверяет по `tagName`, а не по классам DOM.
 */
export function submitterOf(nativeEvent: unknown): HTMLButtonElement | HTMLInputElement | null {
  if (typeof nativeEvent !== "object" || nativeEvent === null || !("submitter" in nativeEvent)) return null;
  const submitter = (nativeEvent as { submitter: unknown }).submitter;
  if (typeof submitter !== "object" || submitter === null || !("tagName" in submitter)) return null;
  const tag = String((submitter as { tagName: unknown }).tagName).toUpperCase();
  return tag === "BUTTON" || tag === "INPUT" ? (submitter as HTMLButtonElement | HTMLInputElement) : null;
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
  /** Обработчик `<form onSubmit>`: отменяет отправку браузера, берёт поля формы вместе с нажатой кнопкой отправки (её `name=value`) и вызывает действие. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** То же для программного вызова с готовыми полями. */
  submit: (data: FormData) => Promise<void>;
};

/** Состояние формы, которое меняет отправка: занятость (повтор гасится) и то, что видит человек. */
export type SubmitState = {
  busy: { current: boolean };
  setPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  setFieldErrors: (fieldErrors: Record<string, string>) => void;
};

/**
 * Где форма и как с неё уйти (в браузере — `window.location`); `onPageShow` — подписка на `pageshow` (аргумент —
 * `event.persisted`: страница вернулась из bfcache), возвращает отписку.
 */
export type SubmitEnv = {
  here: () => Here;
  leave: (href: string) => void;
  onPageShow: (listener: (persisted: boolean) => void) => () => void;
};

/** Через сколько после начала ухода форма снова свободна, если переход так и не состоялся (офлайн, сбой). */
export const LEAVE_TIMEOUT_MS = 10_000;

/**
 * Форма занята, пока страница уходит; если ухода не случилось — освобождается: через LEAVE_TIMEOUT_MS или сразу, когда
 * страница вернулась из bfcache (`pageshow` с `persisted`: кнопку «Назад» нажали после ухода). Освобождение одно.
 */
function holdWhileLeaving(state: SubmitState, env: SubmitEnv): void {
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    clearTimeout(timer);
    unsubscribe();
    state.busy.current = false;
    state.setPending(false);
  };
  const timer = setTimeout(release, LEAVE_TIMEOUT_MS);
  const unsubscribe = env.onPageShow((persisted) => {
    if (persisted) release();
  });
}

/**
 * Одна отправка формы (чистая часть useActionForm, без React): вызов действия и разбор ответа. Пока идёт прошлая отправка,
 * новая игнорируется. Уход со страницы — `redirect()` в действии (Next уже ведёт на новый адрес, а обещание вызова
 * отклоняет ошибкой перехода: это не сбой, ошибки нет) или ответ «сессия истекла» / «нужно согласие» (outcomeOf → leave):
 * форма ОСТАЁТСЯ занятой, иначе кнопка ожила бы посреди перехода и второе нажатие вызвало бы действие ещё раз; если переход
 * не состоялся — освобождается (holdWhileLeaving). Прочий сбой — общий текст, форма снова свободна.
 */
export async function runSubmit<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: UseActionFormOptions<I, T>,
  state: SubmitState,
  env: SubmitEnv,
  data: FormData,
): Promise<void> {
  if (state.busy.current) return;
  state.busy.current = true;
  state.setPending(true);
  state.setError(null);
  state.setFieldErrors({});
  let leaving = false;
  try {
    // Вход проверяет схема действия на сервере, поэтому приведение типа здесь безопасно.
    const input = options.toInput ? options.toInput(data) : (formDataToInput(data) as I);
    const outcome = outcomeOf(await action(input), env.here());
    if (outcome.kind === "success") options.onSuccess?.(outcome.data);
    else if (outcome.kind === "leave") {
      leaving = true;
      env.leave(outcome.href);
    } else {
      state.setError(outcome.error);
      state.setFieldErrors(outcome.fieldErrors);
    }
  } catch (e) {
    if (isRedirectError(e)) {
      leaving = true;
      return;
    }
    logger.warn("app.form: action failed", { error: e });
    state.setError(ru.common.errors.generic);
  } finally {
    if (leaving) holdWhileLeaving(state, env);
    else {
      state.busy.current = false;
      state.setPending(false);
    }
  }
}

/**
 * Состояние формы с Server Action, созданным через `action()` из `@/platform/action`.
 *
 * Форма подключается ТОЛЬКО через `onSubmit`: `<form onSubmit={form.onSubmit}>`. Не `<form action={…}>`: React 19 после
 * завершения такого действия сбрасывает неуправляемые поля формы, и при ошибке проверки человек терял бы введённые
 * телефон или код. `submit(formData)` — для программного вызова. Повторная отправка, пока идёт прошлая, игнорируется. «Сессия
 * истекла» и «нужно согласие» уводят на экран v2 с возвратом (см. `outcomeOf`) и состояния формы не меняют; `redirect()`
 * в самом действии (вход, выбор шага) — уход без ошибки на экране; при уходе форма остаётся занятой (runSubmit). Сбой
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

  const state: SubmitState = { busy, setPending, setError, setFieldErrors };
  const env: SubmitEnv = {
    here: () => window.location,
    leave: (href) => window.location.assign(href),
    onPageShow: (listener) => {
      const handler = (event: PageTransitionEvent) => listener(event.persisted);
      window.addEventListener("pageshow", handler);
      return () => window.removeEventListener("pageshow", handler);
    },
  };
  const submit = (data: FormData): Promise<void> => runSubmit(action, options, state, env, data);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const submitter = submitterOf(event.nativeEvent);
    void submit(submitter ? new FormData(event.currentTarget, submitter) : new FormData(event.currentTarget));
  }

  return { pending, error, fieldErrors, onSubmit, submit };
}
