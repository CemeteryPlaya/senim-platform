"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useReducer, useRef, useState, type RefObject } from "react";
import { formatTime } from "@/features/format/format";
import { initialSigningState, signingReducer, type SignMethodChoice, type SigningState } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Notice, RadioCard, RadioGroup, Section, SignaturePad, Stack, toast, type SignatureValue } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../../_shell/FormError";
import { outcomeOf } from "../../../../../../_shell/form";
import { completeSigningAction, signByHandAction, startSigningAction } from "../actions";
import { methodsFor, type SignKind, type StepView } from "./sign-view";

const t = ru.app.deal.sign;


export type SignAreaProps = {
  documentId: string;
  kind: SignKind;
  step: StepView;
  /** Карточка сделки: туда — после подписи, с тостом. */
  dealHref: string;
  device: Device;
  /** ФИО покупателя из профиля: подставляется в поле «Ввести ФИО» (можно изменить). */
  fullName: string;
};

/** Что сделать с ответом действия: успех — данные; уход (вход, согласие, карточка) — уже начат; отказ — текст. */
type Handled<T> = { kind: "ok"; data: T } | { kind: "leaving" } | { kind: "error"; error: string };

function useHandle(dealHref: string) {
  const router = useRouter();
  return function handle<T>(result: ActionResult<T>): Handled<T> {
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "leave") {
      window.location.assign(outcome.href);
      return { kind: "leaving" };
    }
    if (outcome.kind === "error") {
      // Документ или сделку изменили (заменили редакцию, сменился шаг, вторая вкладка): подписывать здесь больше нечего —
      // тост с причиной и карточка сделки (её главное действие ведёт на действующую редакцию).
      if (!result.ok && result.code === "CONFLICT") {
        toast.error(outcome.error);
        router.push(dealHref);
        return { kind: "leaving" };
      }
      return { kind: "error", error: Object.values(outcome.fieldErrors)[0] ?? outcome.error };
    }
    return { kind: "ok", data: outcome.data };
  };
}

/** Подпись поставлена целиком (своя часть): тост и карточка сделки. */
function useFinish(kind: SignKind, dealHref: string) {
  const router = useRouter();
  return () => {
    toast(t.signed[kind]);
    router.push(dealHref);
  };
}

/**
 * Шаг подписи документа покупателем — как в v1 и по требованиям модуля: сначала подпись от руки (холст или ФИО), затем
 * ЭЦП. Одно главное действие шага — в `ActionDock` последним (на телефоне у нижнего края). После подписи от руки экран
 * перечитывается и показывает шаг ЭЦП; после последней своей подписи — карточка сделки с тостом.
 * Шаг — ключ компонента: при смене шага состояние начинается заново.
 */
export function SignArea(props: SignAreaProps) {
  return props.step.kind === "hand" ? <HandStep key="hand" {...props} /> : <EcpStep key="ecp" {...props} />;
}

/** Где человек в подписи: «Шаг 1 из 2: подпись от руки. Затем — ЭЦП» / «Шаг 2 из 2: электронная подпись». */
function StepTitle({ step }: { step: StepView }) {
  if (step.total < 2) return null;
  return <p className="text-body text-ink">{step.kind === "hand" ? t.steps.handFirst : t.steps.ecpSecond}</p>;
}

function HandStep({ documentId, kind, step, dealHref, fullName }: SignAreaProps) {
  const router = useRouter();
  const handle = useHandle(dealHref);
  const finish = useFinish(kind, dealHref);
  const reasonId = useId();
  const [value, setValue] = useState<SignatureValue | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function submit() {
    if (busy.current || value === null) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const input = typeof value === "string" ? { documentId, imageDataUrl: value } : { documentId, typedName: value.typedName };
    const out = handle(await signByHandAction(input));
    if (out.kind === "leaving") return;
    if (out.kind === "error") {
      setError(out.error);
      busy.current = false;
      setPending(false);
      return;
    }
    if (step.ecpAfterHand) {
      // Кнопка остаётся занятой до смены шага: второе нажатие не уходит.
      toast(t.hand.done);
      router.refresh();
      return;
    }
    finish();
  }

  return (
    <>
      <Section title={t.hand.section}>
        <Stack gap="tight">
          <StepTitle step={step} />
          <SignaturePad label={t.hand.padLabel} defaultTypedName={fullName} onChange={setValue} />
          <p className="text-sub text-muted">{t.hand.consent}</p>
          {/* Почему кнопка отключена — рядом с ней, видимым текстом (на телефоне кнопка в доке у нижнего края). */}
          {value === null && (
            <p id={reasonId} className="text-body text-ink">
              {t.hand.empty}
            </p>
          )}
        </Stack>
        <FormError error={error} />
      </Section>
      <ActionDock>
        <Button onClick={submit} pending={pending} disabled={value === null} aria-describedby={value === null ? reasonId : undefined}>
          {t.hand.submit}
        </Button>
      </ActionDock>
    </>
  );
}

/** Время сессии вышло (по часам браузера): с этого момента — «Подписать заново». */
function useExpired(state: SigningState): boolean {
  const expiresAt = state.step === "awaiting" || state.step === "completing" ? state.session.expiresAt : null;
  const at = expiresAt ? new Date(expiresAt).getTime() : null;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const left = at - Date.now();
    const timer = setTimeout(() => setExpiredAt(at), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [at]);
  return at !== null && expiredAt === at;
}

function EcpStep({ documentId, kind, step, dealHref, device }: SignAreaProps) {
  const handle = useHandle(dealHref);
  const methods = methodsFor(device);
  const finish = useFinish(kind, dealHref);
  const [state, dispatch] = useReducer(signingReducer, initialSigningState);
  const expired = useExpired(state);
  const hint = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);

  // Кнопка «Подписать» исчезла — фокус на подсказку, что делать дальше (иначе он падает в начало страницы).
  const awaiting = state.step === "awaiting";
  useEffect(() => {
    if (awaiting) hint.current?.focus();
  }, [awaiting]);

  async function start(method: SignMethodChoice) {
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: "start" });
    const out = handle(await startSigningAction({ documentId, method }));
    busy.current = false;
    if (out.kind === "leaving") return;
    dispatch(out.kind === "ok" ? { type: "started", session: out.data } : { type: "failed", error: out.error });
  }

  async function complete() {
    if (busy.current || state.step !== "awaiting") return;
    busy.current = true;
    dispatch({ type: "complete" });
    const out = handle(await completeSigningAction({ documentId, sessionId: state.session.sessionId }));
    if (out.kind === "leaving") return;
    if (out.kind === "error") {
      busy.current = false;
      dispatch({ type: "failed", error: out.error });
      return;
    }
    dispatch({ type: "completed", fullySigned: out.data.fullySigned });
    finish();
  }

  function restart() {
    if (state.step !== "awaiting") return;
    const method = state.method;
    // Действия применяются по порядку: сброс к выбору, затем новая сессия тем же способом.
    dispatch({ type: "reset" });
    void start(method);
  }

  const choosing = state.step === "choose" || state.step === "starting";
  return (
    <>
      <Section title={t.ecp.section}>
        <Stack gap="tight">
          <StepTitle step={step} />
          {choosing && methods.length === 1 ? (
            <p className="text-body text-muted">{t.ecp.phoneMethod}</p>
          ) : choosing ? (
            <RadioGroup legend={t.ecp.methodLegend}>
              {methods.map((m) => (
                <RadioCard
                  key={m}
                  name="sign-method"
                  value={m}
                  label={t.ecp.methods[m].label}
                  description={t.ecp.methods[m].description}
                  checked={state.method === m}
                  disabled={state.step === "starting"}
                  onChange={() => dispatch({ type: "method", method: m })}
                />
              ))}
            </RadioGroup>
          ) : state.step === "awaiting" || state.step === "completing" ? (
            <Awaiting state={state} expired={expired} hint={hint} />
          ) : null}
        </Stack>
        {state.step === "choose" && state.error && <FormError error={state.error} />}
        {state.step === "awaiting" && state.error && !expired && <FormError error={state.error} />}
      </Section>
      <ActionDock>
        {choosing || state.step === "done" ? (
          <Button onClick={() => state.step === "choose" && void start(state.method)} pending={state.step !== "choose"}>
            {t.ecp.start}
          </Button>
        ) : expired ? (
          <Button onClick={restart}>{t.ecp.restart}</Button>
        ) : (
          <Button onClick={complete} pending={state.step === "completing"}>
            {t.ecp.check}
          </Button>
        )}
        {/* Выбрать другой способ — только когда способов больше одного (на телефоне способ один). */}
        {state.step === "awaiting" && methods.length > 1 && (
          <Button variant="quiet" onClick={() => dispatch({ type: "reset" })}>
            {t.ecp.other}
          </Button>
        )}
      </ActionDock>
    </>
  );
}

function Awaiting({
  state,
  expired,
  hint,
}: {
  state: Extract<SigningState, { step: "awaiting" | "completing" }>;
  expired: boolean;
  hint: RefObject<HTMLParagraphElement | null>;
}) {
  const { session } = state;
  if (expired) return <Notice tone="warn" live>{t.ecp.expired}</Notice>;
  return (
    <Stack gap="tight">
      {session.method === "EGOV_QR" && session.qrImage && (
        // QR — картинка data:image/png от сервера; оптимизатор изображений для data URL не нужен. Светлая подложка QR —
        // часть картинки (сканер читает тёмное на светлом в обеих темах).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={session.qrImage} alt={t.ecp.qrAlt} width={288} height={288} className="size-72 self-start rounded-field" />
      )}
      <p ref={hint} tabIndex={-1} className="text-body text-ink outline-none">
        {session.method === "EGOV_QR" ? t.ecp.qrHint : t.ecp.ncalayerHint}
      </p>
      <p className="text-sub text-muted">{t.ecp.expiresAt(formatTime(session.expiresAt))}</p>
    </Stack>
  );
}
