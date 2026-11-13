"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  Button,
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
import type { Device } from "@/platform/device";
import { useActionForm } from "../../_shell/form";
import { to } from "../../_shell/paths";
import { ResendCode } from "../../_shell/ResendCode";
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

/** Плашка под заголовком шага кода: новый код отправлен повторно или код уже был отправлен раньше. */
type SentNotice = "none" | "resent" | "alreadySent";

/** Код отправлен: номер для показа и повторной отправки, код заглушки SMS (если есть), когда можно запросить новый. */
type Sent = {
  phone: string;
  demoCode: string | null;
  retryAt: number;
  notice: SentNotice;
};

type Props = {
  /** Шаг из адреса. */
  step: LoginStep;
  /** Выбранная при открытии карточка первого шага (preselectedRole). */
  role: LoginRole;
  /** Возврат после входа (уже проверен safeNext). */
  next: string | null;
  device: Device;
};

/**
 * Три шага входа. Шаг задаёт адрес (`step`), а номер и сведения об отправленном коде живут только здесь, в памяти
 * страницы: переход между шагами — по адресу той же страницы, состояние клиентского компонента при этом сохраняется,
 * а номер (ПДн) не попадает ни в адрес, ни в cookie. Шаг кода без отправленного кода (перезагрузка) — снова шаг номера.
 * При смене шага фокус переходит на первое поле нового шага.
 */
export function LoginFlow({ step: requested, role, next, device }: Props) {
  const router = useRouter();
  const [sent, setSent] = useState<Sent | null>(null);
  const step: LoginStep = requested === "code" && sent === null ? "phone" : requested;

  useEffect(() => {
    if (requested === "code" && sent === null) router.replace(loginStepHref("phone", next));
  }, [requested, sent, next, router]);

  const root = useRef<HTMLDivElement>(null);
  const focusField = () => root.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    focusField();
  }, [step]);

  // Код уже был отправлен (запрос раньше минуты): тому же номеру в этой странице прежний код заглушки остаётся на экране.
  // Отсчёт повтора — полный интервал: сервис не сообщает, сколько осталось.
  const codeSent = (data: SentData, resent: boolean) =>
    setSent((previous) => ({
      phone: data.phone,
      demoCode: data.alreadySent ? (previous?.phone === data.phone ? previous.demoCode : null) : data.demoCode,
      retryAt: Date.now() + RESEND_SECONDS * 1000,
      notice: data.alreadySent ? "alreadySent" : resent ? "resent" : "none",
    }));

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
      {step === "code" && sent !== null && (
        <CodeStep
          next={next}
          device={device}
          sent={sent}
          onResent={(data) => {
            codeSent(data, true);
            // Кнопка повтора сменилась строкой отсчёта — фокус на поле кода, а не в никуда.
            focusField();
          }}
        />
      )}
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

/**
 * Шаг 1: покупатель или мастер. Одна карточка выбрана всегда (по умолчанию — «Я покупатель»), поэтому «Продолжить» не бывает
 * «без выбора»; ошибка группы — только если схема действия всё же отказала. В доке одна кнопка; «Уже есть аккаунт? Войти» —
 * тихая ссылка под карточками.
 */
export function RoleStep({ role, next }: { role: LoginRole; next: string | null }) {
  const form = useActionForm(chooseRoleAction);
  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={1} total={TOTAL} title={t.role.title} back={{ href: to("/"), label: t.role.backLabel }} />
        <p className="text-body text-muted">{t.role.lead}</p>
      </Stack>
      <form id={FORM.role} method="post" onSubmit={form.onSubmit} noValidate>
        <Stack gap="section">
          {/* Видимый вопрос — заголовок шага; группе он же служит именем для экранного диктора. */}
          <RadioGroup legend={t.role.title} legendHidden error={form.fieldErrors.role}>
            <RadioCard
              name="role"
              value="client"
              label={t.role.client}
              description={t.role.clientDescription}
              defaultChecked={role === "client"}
            />
            <RadioCard
              name="role"
              value="executor"
              label={t.role.executor}
              description={t.role.executorDescription}
              defaultChecked={role === "executor"}
            />
          </RadioGroup>
          <HiddenField name="next" value={next ?? ""} />
          <FormError error={form.error} atField={Boolean(form.fieldErrors.role)} />
        </Stack>
      </form>
      <TextLink href={loginStepHref("phone", next)}>{t.role.haveAccount}</TextLink>
      <ActionDock>
        <Button type="submit" form={FORM.role} pending={form.pending}>
          {t.role.submit}
        </Button>
      </ActionDock>
    </Stack>
  );
}

/** Ответ запроса кода; `alreadySent` — новый код не выдан (раньше минуты), действует прежний. */
type SentData = { phone: string; demoCode: string | null; alreadySent: boolean };

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
 * Шаг 3: код из SMS. Порядок: поле кода → главная «Войти» → строка повторной отправки → «Изменить номер». На телефоне
 * главная кнопка — в доке у нижнего края (док — последний ребёнок колонки), поэтому повтор и ссылка стоят сразу под
 * полем; на компьютере док в потоке — повтор и ссылка ниже него.
 */
export function CodeStep({
  next,
  device,
  sent,
  onResent,
}: {
  next: string | null;
  device: Device;
  sent: Sent;
  onResent: (data: SentData) => void;
}) {
  const code = useActionForm(verifyCodeAction);
  const resend = useActionForm(requestCodeAction, { onSuccess: onResent });
  const phoneStep = loginStepHref("phone", next);

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
      <TextLink href={phoneStep}>{t.code.changePhone}</TextLink>
    </div>
  );

  return (
    <Stack gap="section">
      <Stack gap="tight">
        <WizardHeader step={3} total={TOTAL} title={t.code.title} back={{ href: phoneStep, label: t.code.backLabel }} />
        <p className="text-body text-muted">{t.code.sentTo(sent.phone)}</p>
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
