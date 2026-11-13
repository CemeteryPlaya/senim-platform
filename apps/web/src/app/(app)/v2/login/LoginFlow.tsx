"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  Button,
  ButtonLink,
  CodeField,
  HiddenField,
  Notice,
  PhoneField,
  RadioCard,
  RadioGroup,
  Stack,
  TextLink,
  WizardHeader,
} from "@/kit";
import { useActionForm } from "../../_shell/form";
import { to } from "../../_shell/paths";
import { chooseRoleAction, requestCodeAction, verifyCodeAction } from "./actions";
import { loginStepHref, RESEND_SECONDS, type LoginRole, type LoginStep } from "./steps";

const t = ru.app.login;
const TOTAL = 3;

/**
 * id форм: кнопки дока стоят вне форм и связаны с ними атрибутом `form`. У всех форм `method="post"`: нажатие до загрузки
 * JavaScript отправит форму браузером — методом GET номер и код оказались бы в адресе (и в журналах, истории); POST просто
 * перерисует тот же шаг.
 */
const FORM = {
  role: "login-role",
  phone: "login-phone",
  code: "login-code",
  resend: "login-resend",
} as const;

/** Код отправлен: номер для показа и повторной отправки, код заглушки SMS (если есть), когда можно запросить новый. */
type Sent = {
  phone: string;
  demoCode: string | null;
  retryAt: number;
  resent: boolean;
};

type Props = {
  /** Шаг из адреса. */
  step: LoginStep;
  /** Предвыбранная карточка первого шага. */
  role: LoginRole | null;
  /** Возврат после входа (уже проверен safeNext). */
  next: string | null;
};

/**
 * Три шага входа. Шаг задаёт адрес (`step`), а номер и сведения об отправленном коде живут только здесь, в памяти
 * страницы: переход между шагами — по адресу той же страницы, состояние клиентского компонента при этом сохраняется,
 * а номер (ПДн) не попадает ни в адрес, ни в cookie. Шаг кода без отправленного кода (перезагрузка) — снова шаг номера.
 * При смене шага фокус переходит на первое поле нового шага.
 */
export function LoginFlow({ step: requested, role, next }: Props) {
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  const step: LoginStep = requested === "code" && sent === null ? "phone" : requested;

  useEffect(() => {
    if (requested === "code" && sent === null) router.replace(loginStepHref("phone", next));
  }, [requested, sent, next, router]);

  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    root.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
  }, [step]);

  const codeSent = (data: { phone: string; demoCode: string | null }, resent: boolean) =>
    setSent({
      phone: data.phone,
      demoCode: data.demoCode,
      retryAt: Date.now() + RESEND_SECONDS * 1000,
      resent,
    });

  return (
    // Компьютер: одна узкая колонка по центру (ширина Narrow), а не растянутая на всю ширину шапка шага и поля слева.
    <div ref={root} className="desktop:mx-auto desktop:max-w-narrow">
      {step === "role" && <RoleStep role={role} next={next} />}
      {step === "phone" && (
        <PhoneStep
          next={next}
          phone={sent?.phone}
          onSent={(data) => {
            codeSent(data, false);
            router.push(loginStepHref("code", next));
          }}
        />
      )}
      {step === "code" && sent !== null && <CodeStep next={next} sent={sent} onResent={(data) => codeSent(data, true)} />}
    </div>
  );
}

/** Общая ошибка формы; `atField` — тот же текст уже стоит у поля, и второй раз он не нужен. */
function FormError({ error, atField = false }: { error: string | null; atField?: boolean }) {
  if (!error || atField) return null;
  return (
    <Notice tone="danger" live>
      {error}
    </Notice>
  );
}

function RoleStep({ role, next }: { role: LoginRole | null; next: string | null }) {
  const form = useActionForm(chooseRoleAction);
  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={1} total={TOTAL} title={t.role.title} back={{ href: to("/"), label: t.role.backLabel }} />
        <p className="text-body text-muted">{t.role.lead}</p>
      </Stack>
      <form id={FORM.role} method="post" onSubmit={form.onSubmit} noValidate>
        <Stack gap="section">
          <RadioGroup legend={t.role.legend} error={form.fieldErrors.role}>
            <RadioCard name="role" value="client" label={t.role.client} defaultChecked={role === "client"} />
            <RadioCard name="role" value="executor" label={t.role.executor} defaultChecked={role === "executor"} />
          </RadioGroup>
          <HiddenField name="next" value={next ?? ""} />
          <FormError error={form.error} atField={Boolean(form.fieldErrors.role)} />
        </Stack>
      </form>
      <ActionDock>
        <Button type="submit" form={FORM.role} pending={form.pending}>
          {t.role.submit}
        </Button>
        <ButtonLink href={loginStepHref("phone", next)} variant="quiet">
          {t.role.haveAccount}
        </ButtonLink>
      </ActionDock>
    </Stack>
  );
}

type SentData = { phone: string; demoCode: string | null };

function PhoneStep({ next, phone, onSent }: { next: string | null; phone: string | undefined; onSent: (data: SentData) => void }) {
  const form = useActionForm(requestCodeAction, { onSuccess: onSent });
  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={2} total={TOTAL} title={t.phone.title} back={{ href: loginStepHref("role", next), label: t.phone.backLabel }} />
        <p className="text-body text-muted">{t.phone.lead}</p>
      </Stack>
      <form id={FORM.phone} method="post" onSubmit={form.onSubmit} noValidate>
        <Stack gap="section">
          <PhoneField label={t.phone.label} name="phone" defaultValue={phone} error={form.fieldErrors.phone} />
          <FormError error={form.error} atField={Boolean(form.fieldErrors.phone)} />
        </Stack>
      </form>
      <ActionDock>
        <Button type="submit" form={FORM.phone} pending={form.pending}>
          {t.phone.submit}
        </Button>
      </ActionDock>
    </Stack>
  );
}

/**
 * «Отправить ещё раз»: недоступна, пока identity не примет новый запрос (RESEND_SECONDS после отправки), и показывает,
 * сколько осталось; раз в секунду, без анимации (при reduced motion считает так же). Новый код — новый `key` у кнопки,
 * отсчёт начинается заново. На телефоне кнопка во всю ширину дока, поэтому смена подписи ничего не сдвигает.
 */
function ResendButton({ until, pending }: { until: number; pending: boolean }) {
  const [left, setLeft] = useState(RESEND_SECONDS);
  useEffect(() => {
    const id = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
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

function CodeStep({ next, sent, onResent }: { next: string | null; sent: Sent; onResent: (data: SentData) => void }) {
  const code = useActionForm(verifyCodeAction);
  const resend = useActionForm(requestCodeAction, { onSuccess: onResent });
  const phoneStep = loginStepHref("phone", next);

  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={3} total={TOTAL} title={t.code.title} back={{ href: phoneStep, label: t.code.backLabel }} />
        <p className="text-body text-muted">{t.code.sentTo(sent.phone)}</p>
        <TextLink href={phoneStep}>{t.code.changePhone}</TextLink>
      </Stack>
      <Stack gap="section">
        {sent.demoCode && (
          <Notice tone="info" live>
            {t.code.shownCode(sent.demoCode)}
          </Notice>
        )}
        {/* Одна строка колонки: форма повтора пустая (только номер) и не должна давать лишний зазор. */}
        <div>
          <form id={FORM.code} method="post" onSubmit={code.onSubmit} noValidate>
            <CodeField label={t.code.label} name="code" error={code.fieldErrors.code} />
            <HiddenField name="phone" value={sent.phone} />
            <HiddenField name="next" value={next ?? ""} />
          </form>
          <form id={FORM.resend} method="post" onSubmit={resend.onSubmit} noValidate>
            <HiddenField name="phone" value={sent.phone} />
          </form>
        </div>
        <FormError error={code.error} atField={Boolean(code.fieldErrors.code)} />
        <FormError error={resend.error} />
        {sent.resent && !resend.error && (
          <Notice tone="info" live>
            {t.code.resent}
          </Notice>
        )}
      </Stack>
      <ActionDock>
        <Button type="submit" form={FORM.code} pending={code.pending}>
          {t.code.submit}
        </Button>
        <ResendButton key={sent.retryAt} until={sent.retryAt} pending={resend.pending} />
      </ActionDock>
    </Stack>
  );
}
