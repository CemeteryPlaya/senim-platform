"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import type { ConsentDocument } from "@/i18n/ru/consent";
import { ActionDock, Button, Card, Checkbox, Explain, HiddenField, Notice, Stack, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../_shell/FormError";
import { useActionForm } from "../../_shell/form";
import { grantConsentAction } from "./actions";

const t = ru.app.onboarding.consent;
const screen = ru.consent.screen;
const FORM = "consent-form";

type Props = {
  /** Текущая редакция текста согласия. */
  document: ConsentDocument;
  /** У человека было согласие прежней редакции — текст обновился. */
  updated: boolean;
  /** Возврат после первых шагов (уже проверен safeNext). */
  next: string | null;
  step: number;
  total: number;
  device: Device;
};

/**
 * Экран согласия: текст в прокручиваемой карточке (область доступна с клавиатуры), отметка «Я согласен», одна главная
 * кнопка в доке («Выйти» — в шапке оболочки, «Назад» на шагах нет). Текст согласия показывается как есть — хэш, который хранит identity, считается от него.
 * Сервер получает редакцию, которую человек видел: если текст сменился между показом и нажатием, действие отвечает
 * CONFLICT, экран перечитывается, а форма (вместе с отметкой) пересоздаётся — новую редакцию подтверждают заново.
 */
export function ConsentForm({ document: doc, updated, next, step, total, device }: Props) {
  const router = useRouter();
  const form = useActionForm(async (input: Parameters<typeof grantConsentAction>[0]) => {
    const res = await grantConsentAction(input);
    if (!res.ok && res.code === "CONFLICT") router.refresh();
    return res;
  });

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <WizardHeader step={step} total={total} title={t.title} />
          {/* Первый раз заголовок говорит сам за себя; про обновлённую редакцию человеку нужно сказать. */}
          {updated && <p className="text-body text-muted">{screen.updated}</p>}
          {/* Кнопка пояснения встаёт по левой линии текста, а не по центру растянутой колонки. */}
          <div>
            <Explain label={t.explain.label} title={t.explain.title} device={device}>
              <p>{t.explain.body}</p>
            </Explain>
          </div>
        </Stack>
        <Stack>
          <Notice tone="warn">{doc.draft}</Notice>
          <Card>
            {/* Область ограниченной высоты со своей прокруткой: на телефоне отметка и кнопка видны на первом экране, нижняя
                строка текста обрезана краем (подсказка, что текст продолжается). В фокусе клавиатуры: стрелки и PageDown
                читают текст, диктор называет область. */}
            <div role="region" aria-label={t.textLabel} tabIndex={0} className="max-h-48 overflow-y-auto desktop:max-h-80">
            <Stack>
              <p className="text-sub text-muted">{screen.edition(doc.version)}</p>
              <p className="text-card text-ink">{doc.title}</p>
              {doc.sections.map((section) => (
                <section key={section.heading} className="flex flex-col gap-1">
                  <h2 className="text-card text-ink">{section.heading}</h2>
                  <p className="text-body text-ink">{section.body}</p>
                </section>
              ))}
            </Stack>
            </div>
          </Card>
        </Stack>
        <form key={doc.version} id={FORM} method="post" onSubmit={form.onSubmit} noValidate>
          <Stack gap="section">
            <Checkbox name="agreed" value="on" label={t.agree} error={form.fieldErrors.agreed} />
            <HiddenField name="version" value={doc.version} />
            <HiddenField name="next" value={next ?? ""} />
            <FormError error={form.error} atField={Boolean(form.fieldErrors.agreed)} />
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
