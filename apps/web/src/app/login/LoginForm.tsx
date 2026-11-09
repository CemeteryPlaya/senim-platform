"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, FullscreenStep, Input } from "@/ui";
import { requestCodeAction, verifyCodeAction } from "./actions";

const t = ru.identity.login;

type Step = { kind: "phone" } | { kind: "code"; phone: string; demoCode: string | null };
type Message = { tone: "danger" | "success"; text: string } | null;

/**
 * Два полноэкранных шага (FullscreenStep): номер → код из SMS. «Назад» на шаге кода возвращает к номеру.
 * После верного кода сервер сам переводит на нужную страницу. extra — второстепенные пути под главной кнопкой
 * шага номера (демо-персоны, регистрация мастера).
 */
export function LoginForm({ next, extra }: { next: string | null; extra?: ReactNode }) {
  const [step, setStep] = useState<Step>({ kind: "phone" });
  const [phoneError, setPhoneError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const visitedCode = useRef(false);

  // Фокус следует за шагом: поле кода после отправки, заголовок — при возврате к номеру.
  useEffect(() => {
    if (step.kind === "code") {
      visitedCode.current = true;
      codeRef.current?.focus();
    } else if (visitedCode.current) {
      headingRef.current?.focus();
    }
  }, [step.kind]);

  function sendCode(phone: string, resend: boolean) {
    setPhoneError(undefined);
    setCodeError(undefined);
    setMessage(null);
    startTransition(async () => {
      const res = await requestCodeAction({ phone });
      if (!res.ok) {
        if (resend) setMessage({ tone: "danger", text: res.error });
        else setPhoneError(res.fieldErrors?.phone?.[0] ?? res.error);
        return;
      }
      setStep({ kind: "code", phone: res.data.phone, demoCode: res.data.demoCode });
      if (resend) setMessage({ tone: "success", text: t.resent });
    });
  }

  function onPhoneSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    sendCode(String(new FormData(e.currentTarget).get("phone") ?? ""), false);
  }

  function onCodeSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "code") return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setCodeError(undefined);
    setMessage(null);
    startTransition(async () => {
      // При успехе действие делает redirect — сюда возвращается только ошибка.
      const res = await verifyCodeAction({ phone: step.phone, code, next });
      if (!res.ok) setCodeError(res.error);
    });
  }

  function changePhone() {
    // Пока идёт запрос (вход или повторный код), «Назад» не срабатывает — как прежняя кнопка с disabled.
    if (pending) return;
    setStep({ kind: "phone" });
    setCodeError(undefined);
    setMessage(null);
  }

  if (step.kind === "phone") {
    return (
      <form onSubmit={onPhoneSubmit} noValidate>
        <FullscreenStep
          title={t.title}
          back={{ href: "/" }}
          titleRef={headingRef}
          action={
            <>
              <Button type="submit" loading={pending} fullWidth>
                {t.getCode}
              </Button>
              {extra}
            </>
          }
        >
          <p className="text-lg text-ink-soft">{t.lead}</p>
          <Input
            label={t.phoneLabel}
            hint={t.phoneHint}
            error={phoneError}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
          />
        </FullscreenStep>
      </form>
    );
  }

  return (
    <form onSubmit={onCodeSubmit} noValidate>
      <FullscreenStep
        title={t.codeTitle}
        back={{ onClick: changePhone }}
        action={
          <>
            <Button type="submit" loading={pending} fullWidth>
              {t.signIn}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => sendCode(step.phone, true)} disabled={pending}>
              {t.resend}
            </Button>
          </>
        }
      >
        <p className="text-lg text-ink-soft">{t.codeSentTo(step.phone)}</p>
        {step.demoCode && (
          <Alert tone="warning" live="polite">
            {t.demoCode(step.demoCode)}
          </Alert>
        )}
        {message && (
          <Alert tone={message.tone} live={message.tone === "danger" ? "assertive" : "polite"}>
            {message.text}
          </Alert>
        )}
        <Input
          ref={codeRef}
          label={t.codeLabel}
          hint={t.codeHint}
          error={codeError}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
        />
      </FullscreenStep>
    </form>
  );
}
