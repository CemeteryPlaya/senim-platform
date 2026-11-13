"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, CodeField, Explain, HiddenField, Notice, Stack, TextField, TextLink, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { secondsLeft } from "../login/steps";
import { requestEmailCodeAction, verifyEmailCodeAction } from "./actions";
import { EMAIL_RESEND_SECONDS, emailStepHref, type EmailStep } from "./steps";

const t = ru.app.onboarding.email;

/**
 * id форм: кнопки стоят вне форм и связаны с ними атрибутом `form`. У всех форм `method="post"`: нажатие до загрузки
 * JavaScript отправит форму браузером — методом GET адрес почты и код оказались бы в адресе страницы (и в журналах).
 */
const FORM = {
  address: "email-address",
  code: "email-code",
  resend: "email-resend",
} as const;

/** Код отправлен: адрес для показа и повторной отправки, код заглушки писем (если есть), когда можно запросить новый. */
type Sent = {
  email: string;
  demoCode: string | null;
  retryAt: number;
  resent: boolean;
};

type SentData = { email: string; demoCode: string | null };

type Props = {
  /** Шаг из адреса страницы. */
  step: EmailStep;
  /** Возврат после первых шагов (уже проверен safeNext). */
  next: string | null;
  /** «Шаг N из M» онбординга (onboardingPosition). */
  position: { step: number; total: number };
  device: Device;
};

/**
 * Почта — два шага на одной странице: адрес, затем код из письма. Как у входа: шаг задаёт адрес страницы (`?step=code`),
 * а адрес почты и сведения об отправленном коде живут только здесь, в памяти страницы, — в адрес страницы, cookie и
 * журналы они не попадают. Шаг кода без отправленного кода (перезагрузка) — снова шаг адреса. При смене шага фокус
 * переходит на первое поле нового шага.
 */
export function EmailFlow({ step: requested, next, position, device }: Props) {
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  const step: EmailStep = requested === "code" && sent === null ? "address" : requested;

  useEffect(() => {
    if (requested === "code" && sent === null) router.replace(emailStepHref("address", next));
  }, [requested, sent, next, router]);

  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    root.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
  }, [step]);

  const codeSent = (data: SentData, resent: boolean) =>
    setSent({ email: data.email, demoCode: data.demoCode, retryAt: Date.now() + EMAIL_RESEND_SECONDS * 1000, resent });

  return (
    // Компьютер: одна узкая колонка по центру (ширина Narrow), как у остальных шагов.
    <div ref={root} className="desktop:mx-auto desktop:max-w-narrow">
      {step === "address" && (
        <AddressStep
          next={next}
          position={position}
          device={device}
          email={sent?.email}
          onSent={(data) => {
            codeSent(data, false);
            router.push(emailStepHref("code", next));
          }}
        />
      )}
      {step === "code" && sent !== null && (
        <CodeStep next={next} position={position} sent={sent} onResent={(data) => codeSent(data, true)} />
      )}
    </div>
  );
}

type AddressProps = {
  next: string | null;
  position: { step: number; total: number };
  device: Device;
  /** Адрес, на который уже отправляли код («Изменить адрес» возвращает его в поле). */
  email: string | undefined;
  onSent: (data: SentData) => void;
};

/** Шаг 1: адрес. Ошибка формата — у поля, лимиты — общей плашкой; зачем почта — по нажатию (Explain). */
export function AddressStep({ next, position, device, email, onSent }: AddressProps) {
  const form = useActionForm(requestEmailCodeAction, { onSuccess: onSent });
  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={position.step} total={position.total} title={t.address.title} />
        <p className="text-body text-muted">{t.address.lead}</p>
        {/* Кнопка пояснения встаёт по левой линии текста, а не по центру растянутой колонки. */}
        <div>
          <Explain label={t.explain.label} title={t.explain.title} device={device}>
            <p>{t.explain.body}</p>
          </Explain>
        </div>
      </Stack>
      <form id={FORM.address} method="post" onSubmit={form.onSubmit} noValidate>
        <Stack gap="section">
          <TextField
            label={t.address.label}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={email}
            error={form.fieldErrors.email}
          />
          <HiddenField name="next" value={next ?? ""} />
          <FormError error={form.error} atField={Boolean(form.fieldErrors.email)} />
        </Stack>
      </form>
      <ActionDock>
        <Button type="submit" form={FORM.address} pending={form.pending}>
          {t.address.submit}
        </Button>
      </ActionDock>
    </Stack>
  );
}

/**
 * «Отправить ещё раз»: недоступна, пока identity не примет новый запрос (EMAIL_RESEND_SECONDS после отправки), и
 * показывает, сколько осталось; раз в секунду, без анимации. Первая отрисовка — от `until`. Новый код — новый `key`.
 */
export function ResendButton({ until, pending }: { until: number; pending: boolean }) {
  const [left, setLeft] = useState(() => secondsLeft(until, Date.now()));
  useEffect(() => {
    if (secondsLeft(until, Date.now()) === 0) return;
    const id = window.setInterval(() => {
      const seconds = secondsLeft(until, Date.now());
      setLeft(seconds);
      if (seconds === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return (
    <Button type="submit" form={FORM.resend} variant="quiet" disabled={left > 0} pending={pending}>
      {left > 0 ? t.code.resendIn(left) : t.code.resend}
    </Button>
  );
}

type CodeProps = {
  next: string | null;
  position: { step: number; total: number };
  sent: Sent;
  onResent: (data: SentData) => void;
};

/**
 * Шаг 2: код из письма. В доке одна кнопка «Подтвердить»; «Изменить адрес» (ссылка) и «Отправить ещё раз» (тихая
 * кнопка) — вне дока. Неверный, устаревший код и исчерпанные попытки — у поля, лимиты — плашкой.
 */
export function CodeStep({ next, position, sent, onResent }: CodeProps) {
  const code = useActionForm(verifyEmailCodeAction);
  const resend = useActionForm(requestEmailCodeAction, { onSuccess: (data) => onResent(data) });

  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={position.step} total={position.total} title={t.code.title} />
        {/* Длинный адрес без пробелов переносится, а не растягивает экран вбок. */}
        <p className="text-body text-muted wrap-anywhere">{t.code.sentTo(sent.email)}</p>
        <TextLink href={emailStepHref("address", next)}>{t.code.changeEmail}</TextLink>
      </Stack>
      <Stack gap="section">
        {sent.demoCode && (
          <Notice tone="info" live>
            {t.code.shownCode(sent.demoCode)}
          </Notice>
        )}
        {/* Одна строка колонки: форма повтора пустая (только адрес) и не должна давать лишний зазор. */}
        <div>
          <form id={FORM.code} method="post" onSubmit={code.onSubmit} noValidate>
            <CodeField label={t.code.label} name="code" error={code.fieldErrors.code} />
            <HiddenField name="next" value={next ?? ""} />
          </form>
          <form id={FORM.resend} method="post" onSubmit={resend.onSubmit} noValidate>
            <HiddenField name="email" value={sent.email} />
            <HiddenField name="next" value={next ?? ""} />
          </form>
        </div>
        <FormError error={code.error} atField={Boolean(code.fieldErrors.code)} />
        <FormError error={resend.error} />
        {sent.resent && !resend.error && (
          <Notice tone="info" live>
            {t.code.resent}
          </Notice>
        )}
        <div>
          <ResendButton key={sent.retryAt} until={sent.retryAt} pending={resend.pending} />
        </div>
      </Stack>
      <ActionDock>
        <Button type="submit" form={FORM.code} pending={code.pending}>
          {t.code.submit}
        </Button>
      </ActionDock>
    </Stack>
  );
}
