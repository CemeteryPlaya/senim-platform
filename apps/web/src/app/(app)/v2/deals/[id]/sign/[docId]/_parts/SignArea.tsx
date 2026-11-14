"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useReducer, useRef, useState, type RefObject } from "react";
import { formatTime } from "@/features/format/format";
import { initialSigningState, signingReducer, type SignMethodChoice, type SigningState } from "@/features/signing/state";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { ActionDock, Button, Checkbox, Notice, RadioCard, RadioGroup, Section, SignaturePad, Stack, toast, type SignatureValue } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../../_shell/FormError";
import { outcomeOf } from "../../../../../../_shell/form";
import type { DealSide } from "../../../../../../_shell/side";
import { BankConsentText } from "../../../_parts/BankConsentText";
import { completeSigningAction, signByHandAction, startSigningAction } from "../actions";
import { methodsFor, type SignKind, type StepView } from "./sign-view";

const t = ru.app.deal.sign;
const tc = ru.app.masterSteps.sign.consent;

export type SignAreaProps = {
  dealId: string;
  documentId: string;
  /** Сторона документа: подпись холста называет её («Подпись покупателя» / «Подпись мастера»). */
  side: DealSide;
  kind: SignKind;
  step: StepView;
  /** Карточка сделки: туда — после подписи, с тостом. */
  dealHref: string;
  device: Device;
  /** ФИО из профиля: подставляется в поле «Ввести ФИО» (можно изменить). */
  fullName: string;
  /**
   * Замок согласия для банка (мастер, оферта, своего согласия ещё нет): текст согласия и отметка над подписью; без отметки
   * кнопка подписи отключена, причина — рядом. Отметка уходит вместе с подписью. `null` — замка нет.
   */
  consent: { document: ConsentDocument } | null;
};

/** Что сделать с ответом действия: успех — данные; уход (вход, согласие, карточка) — уже начат; отказ — текст (и поле). */
type Handled<T> = { kind: "ok"; data: T } | { kind: "leaving" } | { kind: "error"; error: string; field?: string };

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
      const agreed = outcome.fieldErrors.agreed;
      if (agreed) return { kind: "error", error: agreed, field: "agreed" };
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
 * Шаг подписи документа стороной сделки — как в v1 и по требованиям модуля: сначала подпись от руки (холст или ФИО), затем
 * ЭЦП. Замок согласия для банка (мастер, оферта) — отметка над подписью, без неё кнопка закрыта с объяснением; отказ
 * сервера по отметке — у неё. Одно главное действие шага — в `ActionDock` последним (на телефоне у нижнего края). После подписи от руки экран
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

/** Согласие для банка над подписью (замок мастера): текст с прокруткой и отметка; отказ сервера — у отметки. */
function ConsentGate({ document: doc, agreed, onChange, error }: { document: ConsentDocument; agreed: boolean; onChange: (agreed: boolean) => void; error: string | null }) {
  return (
    <Section title={tc.section}>
      <p className="text-body text-muted">{tc.lead}</p>
      <BankConsentText document={doc} />
      <Checkbox name="agreed" value="on" label={tc.agree} checked={agreed} onChange={(e) => onChange(e.currentTarget.checked)} {...(error ? { error } : {})} />
    </Section>
  );
}

/** Отметка согласия для банка, пока замок есть: что отметил человек и ошибка у отметки. */
function useConsentGate(consent: SignAreaProps["consent"]) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    locked: consent !== null && !agreed,
    /** Поля отметки для действия: только при замке. */
    fields: consent && agreed ? { agreed: "on" as const, version: consent.document.version } : {},
    gate: consent && (
      <ConsentGate
        document={consent.document}
        agreed={agreed}
        error={error}
        onChange={(next) => {
          setAgreed(next);
          setError(null);
        }}
      />
    ),
    setError,
  };
}

function HandStep({ dealId, documentId, kind, side, step, dealHref, fullName, consent }: SignAreaProps) {
  const router = useRouter();
  const handle = useHandle(dealHref);
  const finish = useFinish(kind, dealHref);
  const reasonId = useId();
  const [value, setValue] = useState<SignatureValue | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const lock = useConsentGate(consent);
  const ready = value !== null && !lock.locked;
  const reason = lock.locked ? (value === null ? tc.lockedHand : tc.locked) : t.hand.empty;

  async function submit() {
    if (busy.current || !ready || value === null) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const base = { dealId, documentId, ...lock.fields };
    const input = typeof value === "string" ? { ...base, imageDataUrl: value } : { ...base, typedName: value.typedName };
    const out = handle(await signByHandAction(input));
    if (out.kind === "leaving") return;
    if (out.kind === "error") {
      if (out.field === "agreed") lock.setError(out.error);
      else setError(out.error);
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
      {lock.gate}
      <Section title={t.hand.section}>
        <Stack gap="tight">
          <StepTitle step={step} />
          <SignaturePad label={side === "EXECUTOR" ? ru.app.masterSteps.sign.padLabel : t.hand.padLabel} defaultTypedName={fullName} onChange={setValue} />
          <p className="text-sub text-muted">{t.hand.consent}</p>
          {/* Почему кнопка отключена — рядом с ней, видимым текстом (на телефоне кнопка в доке у нижнего края). */}
          {!ready && (
            <p id={reasonId} className="text-body text-ink">
              {reason}
            </p>
          )}
        </Stack>
        <FormError error={error} />
      </Section>
      <ActionDock>
        <Button onClick={submit} pending={pending} disabled={!ready} aria-describedby={ready ? undefined : reasonId}>
          {t.hand.submit[kind]}
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

function EcpStep({ dealId, documentId, kind, step, dealHref, device, consent }: SignAreaProps) {
  const handle = useHandle(dealHref);
  const lock = useConsentGate(consent);
  const reasonId = useId();
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
    const out = handle(await startSigningAction({ dealId, documentId, method, ...lock.fields }));
    busy.current = false;
    if (out.kind === "leaving") return;
    if (out.kind === "error" && out.field === "agreed") {
      lock.setError(out.error);
      dispatch({ type: "failed", error: "" });
      return;
    }
    dispatch(out.kind === "ok" ? { type: "started", session: out.data } : { type: "failed", error: out.error });
  }

  async function complete() {
    if (busy.current || state.step !== "awaiting") return;
    busy.current = true;
    dispatch({ type: "complete" });
    const out = handle(await completeSigningAction({ dealId, documentId, sessionId: state.session.sessionId }));
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
  // Замок согласия закрывает только начало подписи; начатую сессию он уже пропустил.
  const locked = choosing && lock.locked;
  return (
    <>
      {lock.gate}
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
        {locked && (
          <p id={reasonId} className="text-body text-ink">
            {tc.locked}
          </p>
        )}
        {state.step === "choose" && state.error && <FormError error={state.error} />}
        {state.step === "awaiting" && state.error && !expired && <FormError error={state.error} />}
      </Section>
      <ActionDock>
        {choosing || state.step === "done" ? (
          <Button
            onClick={() => state.step === "choose" && !locked && void start(state.method)}
            pending={state.step !== "choose"}
            disabled={locked}
            aria-describedby={locked ? reasonId : undefined}
          >
            {t.ecp.start[kind]}
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
