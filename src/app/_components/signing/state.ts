import type { StartedSigning } from "@/modules/documents/client";

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
      if (state.step === "starting") return { step: "choose", method: state.method, error: action.error };
      if (state.step === "completing") return { step: "awaiting", method: state.method, session: state.session, error: action.error };
      return state;
    case "reset":
      return state.step === "awaiting" || state.step === "choose" ? { step: "choose", method: state.method } : state;
  }
}
