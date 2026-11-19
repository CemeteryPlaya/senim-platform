"use client";

import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, CodeField, CopyButton, HiddenField, PageTitle, Stack } from "@/kit";
import type { ActionResult } from "@/platform/action";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { confirmEnrollmentAction, verifySecondFactorAction } from "./actions";

const t = ru.app.operator.mfa;
const FORM = "operator-mfa-form";

type Props = {
  /** Возврат после второго шага (уже проверен safeNext); `null` — дом (главная оператора, админка). */
  next: string | null;
  /** Подключение приложения: ключ и QR-код; `null` — приложение уже подключено, нужен только код. */
  enrollment: { secret: string; qrSrc: string } | null;
};

/** Ключ группами по 4 символа — так его проще переписать в приложение. */
const grouped = (secret: string): string => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

type Submit = (input: { code: string; next?: string }) => Promise<ActionResult<unknown>>;

/**
 * Второй шаг входа оператора и администратора: подключение (QR-код, ключ для ручного ввода с копированием, первый код) или код из
 * приложения. Одно главное действие — в доке; шестая цифра отправляет форму сама (`autoSubmit`), кнопка остаётся для
 * повтора. Ошибка кода — под полем (число попыток, повтор кода, лимит); при успехе сервер ведёт на `next`. «Назад» нет:
 * это шаг после входа, выход — «Выйти» в шапке сосредоточенной оболочки.
 */
export function MfaForm({ next, enrollment }: Props) {
  const submit: Submit = enrollment ? confirmEnrollmentAction : verifySecondFactorAction;
  const form = useActionForm(submit);

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <PageTitle title={enrollment ? t.enrollTitle : t.verifyTitle} lead={enrollment ? t.enrollLead : t.verifyLead} />
        {enrollment && (
          <Stack>
            {/* QR — data:-URI из SVG, собранного на сервере: оптимизатор next/image для него не нужен. 224 px — сканируется
                с экрана компьютера и с соседнего телефона. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrSrc} alt={t.qrAlt} width={224} height={224} className="h-auto w-qr max-w-full rounded-field" />
            <Card className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sub text-muted">{t.secretLabel}</p>
                <p className="text-body font-medium wrap-break-word text-ink tabular-nums">{grouped(enrollment.secret)}</p>
              </div>
              <CopyButton value={enrollment.secret} label={t.copySecret} />
            </Card>
            <p className="text-sub text-muted">{t.secretHint}</p>
          </Stack>
        )}
        <form id={FORM} onSubmit={form.onSubmit} noValidate>
          <Stack>
            <CodeField label={t.codeLabel} name="code" error={form.fieldErrors.code} autoFocus={!enrollment} autoSubmit />
            <HiddenField name="next" value={next ?? ""} />
            <FormError error={form.error} atField={Boolean(form.fieldErrors.code)} />
          </Stack>
        </form>
        {!enrollment && <p className="text-sub text-muted">{t.lostPhone}</p>}
        <ActionDock>
          <Button type="submit" form={FORM} pending={form.pending}>
            {enrollment ? t.enrollSubmit : t.verifySubmit}
          </Button>
        </ActionDock>
      </Stack>
    </div>
  );
}
