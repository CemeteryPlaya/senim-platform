"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, CodeField, Explain, HiddenField, Notice, Stack, TextField, TextLink, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { ResendCode } from "../../_shell/ResendCode";
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

/** Ответ запроса кода: адрес, код заглушки писем; `alreadySent` — новый код не выдан (раньше минуты), действует прежний. */
type SentData = { email: string; demoCode: string | null; alreadySent: boolean };

/** Плашка под заголовком шага кода: новый код отправлен повторно или код уже был отправлен раньше. */
type SentNotice = "none" | "resent" | "alreadySent";

/** Код отправлен: адрес для показа и повторной отправки, код заглушки писем (если есть), когда можно запросить новый. */
type Sent = {
  email: string;
  demoCode: string | null;
  retryAt: number;
  notice: SentNotice;
};

type Position = { step: number; total: number };

type Props = {
  /** Шаг из адреса страницы. */
  step: EmailStep;
  /** Возврат после первых шагов (уже проверен safeNext). */
  next: string | null;
  /** «Шаг N из M» онбординга (onboardingPosition). */
  position: Position;
  device: Device;
};

/**
 * Что показать после ответа запроса кода. Код уже был отправлен (`alreadySent`): тому же адресу в этой странице — прежний
 * код заглушки остаётся; после перезагрузки прежний адрес неизвестен — кода на экране нет, он в письме. Отсчёт повторной
 * отправки — полный интервал: сервис не сообщает, сколько осталось.
 */
export function sentAfter(previous: Sent | null, data: SentData, resent: boolean, now: number): Sent {
  const demoCode = data.alreadySent ? (previous?.email === data.email ? previous.demoCode : null) : data.demoCode;
  const notice: SentNotice = data.alreadySent ? "alreadySent" : resent ? "resent" : "none";
  return { email: data.email, demoCode, retryAt: now + EMAIL_RESEND_SECONDS * 1000, notice };
}

/**
 * Почта — два шага на одной странице: адрес, затем код из письма. Как у входа: шаг задаёт адрес страницы (`?step=code`),
 * а адрес почты и сведения об отправленном коде живут только здесь, в памяти страницы, — в адрес страницы, cookie и
 * журналы они не попадают. Шаг кода без отправленного кода (перезагрузка) — снова шаг адреса; если код этому адресу уже
 * отправлен (запрос раньше минуты), повторный «Получить код» ведёт обратно на шаг кода с пояснением, а не в тупик.
 * При смене шага фокус переходит на первое поле нового шага.
 */
export function EmailFlow({ step: requested, next, position, device }: Props) {
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  const step: EmailStep = requested === "code" && sent === null ? "address" : requested;

  useEffect(() => {
    if (requested === "code" && sent === null) router.replace(emailStepHref("address", next));
  }, [requested, sent, next, router]);

  const root = useRef<HTMLDivElement>(null);
  const focusField = () => root.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    focusField();
  }, [step]);

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
            setSent((previous) => sentAfter(previous, data, false, Date.now()));
            router.push(emailStepHref("code", next));
          }}
        />
      )}
      {step === "code" && sent !== null && (
        <CodeStep
          next={next}
          position={position}
          device={device}
          sent={sent}
          onResent={(data) => {
            setSent((previous) => sentAfter(previous, data, true, Date.now()));
            // Кнопка повтора сменилась строкой отсчёта — фокус на поле кода, а не в никуда.
            focusField();
          }}
        />
      )}
    </div>
  );
}

type AddressProps = {
  next: string | null;
  position: Position;
  device: Device;
  /** Адрес, на который уже отправляли код в этой странице («Изменить адрес» возвращает его в поле). */
  email: string | undefined;
  onSent: (data: SentData) => void;
};

/**
 * Шаг 1: адрес. Ошибка формата — у поля, лимиты — общей плашкой; зачем почта — по нажатию (Explain). «Слишком часто» на
 * другой адрес, чем тот, куда в этой странице уже ушёл код, — отказ «новый код через минуту»: действующий код у прежнего
 * адреса, и шаг кода для нового адреса солгал бы.
 */
export function AddressStep({ next, position, device, email, onSent }: AddressProps) {
  const [refused, setRefused] = useState<string | null>(null);
  const form = useActionForm(requestEmailCodeAction, {
    onSuccess: (data) => {
      const otherAddress = data.alreadySent && email !== undefined && email !== data.email;
      setRefused(otherAddress ? ru.app.login.email.errors.tooOften : null);
      if (!otherAddress) onSent(data);
    },
  });
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
          <FormError error={form.error ?? (form.pending ? null : refused)} atField={Boolean(form.fieldErrors.email)} />
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

type CodeProps = {
  next: string | null;
  position: Position;
  device: Device;
  sent: Sent;
  onResent: (data: SentData) => void;
};

/**
 * Шаг 2: код из письма. Порядок: поле кода → главная «Подтвердить» → строка повторной отправки → «Изменить адрес».
 * На телефоне главная кнопка — в доке у нижнего края (док — последний ребёнок колонки), поэтому повтор и ссылка стоят
 * сразу под полем; на компьютере док в потоке — повтор и ссылка ниже него. Неверный, устаревший код и исчерпанные
 * попытки — у поля, лимиты — плашкой.
 */
export function CodeStep({ next, position, device, sent, onResent }: CodeProps) {
  const code = useActionForm(verifyEmailCodeAction);
  const resend = useActionForm(requestEmailCodeAction, { onSuccess: onResent });

  const dock = (
    <ActionDock>
      <Button type="submit" form={FORM.code} pending={code.pending}>
        {t.code.submit}
      </Button>
    </ActionDock>
  );
  const secondary = (
    <div>
      <ResendCode
        key={sent.retryAt}
        until={sent.retryAt}
        form={FORM.resend}
        pending={resend.pending}
        label={t.code.resend}
        waitLabel={t.code.resendIn}
      />
      <TextLink href={emailStepHref("address", next)}>{t.code.changeEmail}</TextLink>
    </div>
  );

  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={position.step} total={position.total} title={t.code.title} />
        {/* Длинный адрес без пробелов переносится, а не растягивает экран вбок. */}
        <p className="text-body text-muted wrap-anywhere">{t.code.sentTo(sent.email)}</p>
      </Stack>
      <Stack gap="section">
        {sent.notice === "alreadySent" && (
          <Notice tone="info" live>
            {t.code.alreadySent}
          </Notice>
        )}
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
        {sent.notice === "resent" && !resend.error && (
          <Notice tone="info" live>
            {t.code.resent}
          </Notice>
        )}
      </Stack>
      {device === "desktop" ? (
        <>
          {dock}
          {secondary}
        </>
      ) : (
        <>
          {secondary}
          {dock}
        </>
      )}
    </Stack>
  );
}
