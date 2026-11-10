"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { Button, FullscreenStep, Input } from "@/ui";
import { confirmEnrollmentAction, verifySecondFactorAction } from "./actions";

const t = ru.identity.mfa;

type Props = { next: string } & ({ mode: "enroll"; enrollment: { secret: string; qrSrc: string } } | { mode: "verify"; enrollment?: undefined });

/** Ключ группами по 4 символа — так его проще переписать в приложение. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * Вторая ступень входа оператора: подключение (QR-код и ключ для ручного ввода, первый код) или код из приложения.
 * Одно главное действие — кнопка под полем кода; при успехе сервер сам переводит на next.
 */
export function MfaForm(props: Props) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const enroll = props.mode === "enroll";

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setError(undefined);
    startTransition(async () => {
      const run = enroll ? confirmEnrollmentAction : verifySecondFactorAction;
      const res = await run({ code, next: props.next });
      if (!res.ok && !leaveIfSignedOut(res)) setError(res.fieldErrors?.code?.[0] ?? res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FullscreenStep
        title={enroll ? t.enrollTitle : t.verifyTitle}
        back={{ href: "/" }}
        action={
          <Button type="submit" loading={pending} fullWidth>
            {enroll ? t.enrollSubmit : t.verifySubmit}
          </Button>
        }
      >
        <p className="text-lg text-ink-soft">{enroll ? t.enrollLead : t.verifyLead}</p>
        {props.mode === "enroll" && (
          <>
            {/* QR — data:-URI из SVG, собранного на сервере: оптимизатор next/image для него не нужен. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={props.enrollment.qrSrc} alt={t.qrAlt} width={224} height={224} className="self-center rounded-card border border-line bg-white p-2" />
            <Input label={t.secretLabel} hint={t.secretHint} value={grouped(props.enrollment.secret)} readOnly spellCheck={false} className="font-mono tracking-wider" />
          </>
        )}
        <Input
          label={t.codeLabel}
          hint={t.codeHint}
          error={error}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          required
          autoFocus={!enroll}
        />
        {!enroll && <p className="text-base text-muted">{t.lostPhone}</p>}
      </FullscreenStep>
    </form>
  );
}
