"use client";

import { ru } from "@/i18n/ru";
import { ActionDock, Button, Explain, HiddenField, Stack, TextField, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { LogoutButton } from "../../_shell/LogoutButton";
import { to } from "../../_shell/paths";
import { introduceAction } from "./actions";

const t = ru.app.onboarding.welcome;
const FORM = "welcome-form";

type Props = {
  /** ФИО, если оно уже есть в проекции (ИИН ещё нет). */
  defaultFullName: string | null;
  /** Возврат после первых шагов (уже проверен safeNext). */
  next: string | null;
  step: number;
  total: number;
  device: Device;
};

/**
 * Знакомство: ФИО и ИИН, ошибки сразу у полей (в том числе отказы identity: формат ИИН, «ИИН уже указан», лимит попыток),
 * одна главная кнопка в доке и «Выйти» рядом. Постоянных подсказок под полями нет: зачем ИИН — по нажатию (Explain).
 * Введённое остаётся в полях при ошибке (форма на onSubmit, а не на action).
 */
export function WelcomeForm({ defaultFullName, next, step, total, device }: Props) {
  const form = useActionForm(introduceAction);
  const fieldError = Boolean(form.fieldErrors.fullName || form.fieldErrors.iin);

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <WizardHeader step={step} total={total} title={t.title} back={{ href: to("/"), label: ru.app.onboarding.backLabel }} />
          <p className="text-body text-muted">{t.lead}</p>
          {/* Кнопка пояснения встаёт по левой линии текста, а не по центру растянутой колонки. */}
          <div>
            <Explain label={t.explain.label} title={t.explain.title} device={device}>
              <p>{t.explain.body}</p>
            </Explain>
          </div>
        </Stack>
        <form id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack gap="section">
            <TextField
              label={t.fullName}
              name="fullName"
              autoComplete="name"
              maxLength={200}
              defaultValue={defaultFullName ?? undefined}
              error={form.fieldErrors.fullName}
            />
            <TextField label={t.iin} name="iin" inputMode="numeric" autoComplete="off" maxLength={15} error={form.fieldErrors.iin} />
            <HiddenField name="next" value={next ?? ""} />
            <FormError error={form.error} atField={fieldError} />
          </Stack>
        </form>
        <ActionDock>
          <Button type="submit" form={FORM} pending={form.pending}>
            {t.submit}
          </Button>
          <LogoutButton />
        </ActionDock>
      </Stack>
    </div>
  );
}
