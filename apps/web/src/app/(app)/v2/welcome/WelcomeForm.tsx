"use client";

import { ru } from "@/i18n/ru";
import { ActionDock, Button, Explain, HiddenField, IinField, Stack, TextField, TextLink } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { OnboardingHeader } from "../../_shell/OnboardingHeader";
import { SUPPORT_HREF } from "../../_shell/support";
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
 * одна главная кнопка в доке («Выйти» — в шапке оболочки). Постоянных подсказок под полями нет: зачем ИИН — по нажатию (Explain).
 * Введённое остаётся в полях при ошибке (форма на onSubmit, а не на action).
 */
export function WelcomeForm({ defaultFullName, next, step, total, device }: Props) {
  const form = useActionForm(introduceAction);
  const fieldError = Boolean(form.fieldErrors.fullName || form.fieldErrors.iin);

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <OnboardingHeader step={step} total={total} title={t.title} />
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
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              maxLength={200}
              defaultValue={defaultFullName ?? undefined}
              error={form.fieldErrors.fullName}
            />
            {/* ИИН уже у другого профиля: под полем — как написать в поддержку (адрес из конфига бренда). */}
            <div className="flex flex-col">
              <IinField label={t.iin} name="iin" error={form.fieldErrors.iin} />
              {form.fieldErrors.iin === t.errors.iinTaken && <TextLink href={SUPPORT_HREF}>{t.errors.supportLink}</TextLink>}
            </div>
            <HiddenField name="next" value={next ?? ""} />
            <FormError error={form.error} atField={fieldError} />
          </Stack>
        </form>
        <ActionDock>
          <Button type="submit" form={FORM} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </div>
  );
}
