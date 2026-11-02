import type { SigningDocumentView, StartedSigning } from "@/modules/documents/client";

/** Способы, которые выбирает пользователь (MOCK — только внутри мок-провайдера). */
export type SignMethodChoice = "EGOV_QR" | "NCALAYER";
export type SigningSessionView = Pick<StartedSigning, "sessionId" | "method" | "qrImage" | "expiresAt" | "provider">;

/**
 * Шаги подписи на экране: выбрать способ → сервер начал сессию (QR или NCALayer) →
 * пользователь подписал в приложении → сервер проверил подпись.
 */
export type SigningState =
  | { step: "choose"; method: SignMethodChoice; error?: string }
  | { step: "starting"; method: SignMethodChoice }
  | { step: "awaiting"; method: SignMethodChoice; session: SigningSessionView; error?: string }
  | { step: "completing"; method: SignMethodChoice; session: SigningSessionView }
  | { step: "done"; fullySigned: boolean };

export type SigningAction =
  | { type: "method"; method: SignMethodChoice }
  | { type: "start" }
  | { type: "started"; session: SigningSessionView }
  | { type: "complete" }
  | { type: "completed"; fullySigned: boolean }
  | { type: "failed"; error: string }
  | { type: "reset" };

/**
 * Что показать вместо «Подписать», если подписать нельзя: «Вы подписали» — только когда подпись этой
 * стороны есть; документ на подписи, а подписи нет — шаг сделки её не принимает (расторгнута, отменена).
 */
export function signNotice(doc: Pick<SigningDocumentView, "status" | "myParty" | "canSign" | "signatures">): "youSigned" | "notSignable" | null {
  if (doc.canSign || doc.status !== "SIGNING") return null;
  return doc.signatures.some((s) => s.party === doc.myParty) ? "youSigned" : "notSignable";
}

export const initialSigningState: SigningState = { step: "choose", method: "EGOV_QR" };

/** Переходы; действие не к месту (двойное нажатие, запоздалый ответ) возвращает то же состояние. */
export function signingReducer(state: SigningState, action: SigningAction): SigningState {
  switch (action.type) {
    case "method":
      return state.step === "choose" ? { step: "choose", method: action.method } : state;
    case "start":
      return state.step === "choose" ? { step: "starting", method: state.method } : state;
    case "started":
      return state.step === "starting" ? { step: "awaiting", method: state.method, session: action.session } : state;
    case "complete":
      return state.step === "awaiting" ? { step: "completing", method: state.method, session: state.session } : state;
    case "completed":
      return state.step === "completing" ? { step: "done", fullySigned: action.fullySigned } : state;
    case "failed":
      return failed(state, action.error);
    case "reset":
      return reset(state);
  }
}

/** Ошибка начала — обратно к выбору способа; ошибка проверки — снова ждём подпись в той же сессии. */
function failed(state: SigningState, error: string): SigningState {
  if (state.step === "starting") return { step: "choose", method: state.method, error };
  if (state.step === "completing") return { step: "awaiting", method: state.method, session: state.session, error };
  return state;
}

/** «Выбрать другой способ»: из ожидания подписи или из выбора (сбросить ошибку). */
function reset(state: SigningState): SigningState {
  return state.step === "awaiting" || state.step === "choose" ? { step: "choose", method: state.method } : state;
}

/**
 * Куда перевести фокус после смены шага: кнопка, на которой он стоял, исчезает. Итог подписи —
 * на сообщение; возврат к выбору из ожидания — на выбранный способ; иначе фокус не трогаем.
 */
export function focusTargetAfter(was: SigningState["step"], now: SigningState["step"]): "result" | "method" | null {
  if (was === now) return null;
  if (now === "done") return "result";
  return now === "choose" && (was === "awaiting" || was === "completing") ? "method" : null;
}
