"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { stepInputSchema, type WizardScreen } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Button, focusFirstInvalid, FullscreenStep } from "@/ui";
import { saveStepAction } from "../actions";
import { useRunAction } from "../_parts/ActionButton";

// Общее для экранов мастера: проверка шага схемой модуля, сохранение черновика и переход, разметка формы.

export type Errors = Record<string, string[] | undefined>;

/** Рамка полноэкранного шага: куда ведёт «Назад» и шкала шагов мастера. */
export type StepFrame = { back: string; progress: ReactNode };

export type StepBase = { draftId: string | null; like: string | null; next: WizardScreen | null; frame: StepFrame };

export const first = (errors: Errors, key: string) => errors[key]?.[0];

/** Проверка шага той же схемой, что и на сервере, затем сохранение черновика и переход дальше. */
export function useStep({ draftId, like, next }: StepBase) {
  const [errors, setErrors] = useState<Errors>({});
  const { run, pending, error } = useRunAction(saveStepAction, (d) => `/requests/new?draft=${d.requestId}&step=${next}`);
  /** Сырые значения формы: разбирает их схема шага (граница — здесь и на сервере). */
  const submit = (step: { screen: WizardScreen } & Record<string, unknown>) => {
    const parsed = stepInputSchema.safeParse(step);
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as Errors);
      return;
    }
    setErrors({});
    void run({ requestId: draftId, like: draftId ? null : like, step: parsed.data });
  };
  return { submit, pending, error, errors, setErrors };
}

/**
 * Форма шага — полноэкранный шаг (FullscreenStep: один вопрос — одна кнопка): «Назад», шкала шагов, заголовок,
 * пояснение, поля, кнопки внизу. После неудачной проверки фокус идёт на первое поле с ошибкой (диктор прочитает
 * её текст); если такого поля нет (например, ошибка у фото) — на сводку над кнопками.
 * Кнопки внизу: главная — справа на компьютере и сверху на телефоне.
 */
export function StepForm({
  onSubmit,
  errors,
  title,
  lead,
  frame,
  children,
  actions,
}: {
  onSubmit: () => void;
  errors: Errors;
  title: string;
  lead: ReactNode;
  frame: StepFrame;
  children: ReactNode;
  actions: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const invalid = Object.values(errors).some((list) => list && list.length > 0);
  // errors — новый объект после каждой проверки, поэтому фокус переходит и при повторной ошибке.
  useEffect(() => {
    if (!invalid || !form.current) return;
    if (!focusFirstInvalid(form.current)) summary.current?.focus();
  }, [errors, invalid]);
  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form ref={form} noValidate onSubmit={handle}>
      <FullscreenStep
        title={title}
        back={{ href: frame.back }}
        progress={frame.progress}
        action={
          <>
            {invalid && (
              <p ref={summary} tabIndex={-1} className="text-base font-semibold text-danger">
                {ru.common.errors.checkForm}
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{actions}</div>
          </>
        }
      >
        <p className="text-lg text-ink-soft">{lead}</p>
        <div className="flex flex-col gap-8">{children}</div>
      </FullscreenStep>
    </form>
  );
}

export function NextButton({ pending, label = ru.requests.wizard.next }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" loading={pending} iconEnd={<ArrowRight />} className="sm:min-w-56">
      {label}
    </Button>
  );
}

/** «Пропустить» — второстепенная кнопка рядом с «Далее». */
export function SkipButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" disabled={pending} onClick={onClick}>
      {ru.requests.wizard.skip}
    </Button>
  );
}
