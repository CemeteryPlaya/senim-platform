import { ru } from "@/i18n/ru";
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

export type SignStep = "hand" | "ecp" | "youSigned" | "notSignable" | "operator" | "notRequired" | "closed";

/**
 * Какой шаг подписи показать: сначала собственноручная подпись, затем ЭЦП (решение 2.2.4).
 * «Вы поставили все подписи» — только когда есть все требуемые подписи этой стороны; подписи нет,
 * а подписать нельзя — шаг сделки её не принимает (отменена, ещё не сдана, открыт спор).
 */
export function signStep(doc: Pick<SigningDocumentView, "status" | "signable" | "myParty" | "canSign" | "parties">): SignStep {
  if (doc.myParty === null) return "operator";
  if (!doc.signable) return "notRequired";
  if (doc.status !== "SIGNING") return "closed";
  if (doc.canSign.hand) return "hand";
  if (doc.canSign.ecp) return "ecp";
  const mine = doc.parties.find((p) => p.party === doc.myParty);
  const done = mine && (!mine.required.hand || mine.hand) && (!mine.required.ecp || mine.ecp);
  return done ? "youSigned" : "notSignable";
}

export const initialSigningState: SigningState = { step: "choose", method: "EGOV_QR" };

/** Переходы; действие не к месту (двойное нажатие, запоздалый ответ) возвращает то же состояние. */
export function signingReducer(state: SigningState, action: SigningAction): SigningState {
  switch (action.type) {
    case "method":
      return from(state, "choose", () => ({ step: "choose", method: action.method }));
    case "start":
      return from(state, "choose", (s) => ({ step: "starting", method: s.method }));
    case "started":
      return from(state, "starting", (s) => ({ step: "awaiting", method: s.method, session: action.session }));
    case "complete":
      return from(state, "awaiting", (s) => ({ step: "completing", method: s.method, session: s.session }));
    case "completed":
      return from(state, "completing", () => ({ step: "done", fullySigned: action.fullySigned }));
    case "failed":
      return failed(state, action.error);
    case "reset":
      return reset(state);
  }
}

type Step = SigningState["step"];
const isStep = <K extends Step>(state: SigningState, step: K): state is Extract<SigningState, { step: K }> => state.step === step;

/** Переход только из шага `step`; из любого другого действие не к месту — состояние то же. */
function from<K extends Step>(state: SigningState, step: K, next: (s: Extract<SigningState, { step: K }>) => SigningState): SigningState {
  return isStep(state, step) ? next(state) : state;
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

/** Подписи: «2 из 4» по требуемым подписям обеих сторон. */
export function signatureProgress(doc: Pick<SigningDocumentView, "parties">): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const p of doc.parties) {
    total += Number(p.required.hand) + Number(p.required.ecp);
    done += Number(p.required.hand && p.hand !== null) + Number(p.required.ecp && p.ecp !== null);
  }
  return { done, total };
}

/** Метка документа: без подписи — «Подпись не нужна», подписан — «Подписан», иначе «Подписи: N из M». */
export function documentBadge(doc: Pick<SigningDocumentView, "signable" | "status" | "parties">): { tone: "success" | "warning" | "neutral"; text: string } {
  const t = ru.documents;
  if (!doc.signable) return { tone: "neutral", text: t.status.NOT_REQUIRED };
  if (doc.status !== "SIGNING") return { tone: doc.status === "SIGNED" ? "success" : "neutral", text: t.status[doc.status] };
  const { done, total } = signatureProgress(doc);
  return { tone: "warning", text: t.section.signaturesOf(done, total) };
}
