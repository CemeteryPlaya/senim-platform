"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Stack, WizardHeader } from "@/kit";
import type { WizardScreen } from "@/modules/requests/client";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { saveStepAction } from "./actions";
import { readStep, stepErrors, TOTAL_STEPS } from "./steps";

const t = ru.app.requests.wizard;

/** id формы шага: кнопка дока стоит вне формы и связана с ней атрибутом `form`. */
export const WIZARD_FORM = "request-wizard";

/** Общее для шагов: черновик (или, до него, кому адресована заявка), «Назад», номер шага и строка прямой заявки. */
export type WizardBase = {
  draftId: string | null;
  /** Работа «Хочу похожее» — только до черновика. */
  like: string | null;
  /** Публичный номер мастера прямой заявки — только до черновика. */
  executor: number | null;
  index: number;
  back: { href: string; label: string };
  /** «Исполнитель №N» прямой заявки (имя не раскрывается) или `null`. */
  direct: string | null;
};

export type WizardForm = {
  pending: boolean;
  /** Общая ошибка (отказ модуля) или `null`. */
  error: string | null;
  /** Ошибки у полей: проверка схемой шага в браузере и ответ сервера. */
  errors: Record<string, string>;
  /** Номер неудачной проверки в браузере: растёт на каждую — по нему рамка ставит фокус на первое поле с ошибкой. */
  attempt: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Поле изменили — его ошибка уходит (остальные остаются до следующей проверки). */
  onEdit?: (name: string) => void;
};

/**
 * Форма шага «Дальше»: поля проверяет та же схема шага, что и сервер (ошибки сразу у полей, запрос не уходит), затем
 * `saveStepAction` сохраняет черновик и ведёт на следующий шаг. Повторное нажатие, пока идёт сохранение или переход,
 * гасит `useActionForm` (один эффект). `blocked` — отправлять рано (идёт загрузка фото): `onBlocked` объясняет почему.
 */
export function useWizardStep(screen: WizardScreen, base: WizardBase, blocked?: { when: boolean; onBlocked: () => void }): WizardForm {
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const form = useActionForm(saveStepAction, {
    toInput: (fd) => ({
      requestId: base.draftId,
      like: base.draftId ? null : base.like,
      executor: base.draftId ? null : base.executor,
      step: readStep(screen, fd),
    }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked?.when) return blocked.onBlocked();
    const fd = new FormData(event.currentTarget);
    const found = stepErrors(screen, fd);
    if (found) {
      setInvalid(found);
      setAttempt((n) => n + 1);
      return;
    }
    setInvalid({});
    void form.submit(fd);
  }
  function onEdit(name: string) {
    // Тип мебели собирается из трёх полей: правка любого из них снимает ошибку выбора типа.
    const keys = ["furnitureType", "furnitureTypeOther", "customType"].includes(name) ? ["furnitureTypeId", "customType"] : [name];
    if (keys.some((key) => key in invalid)) setInvalid((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))));
  }
  return { pending: form.pending, error: form.error, errors: { ...form.fieldErrors, ...invalid }, attempt, onSubmit, onEdit };
}

type FrameProps = {
  base: WizardBase;
  title: string;
  lead?: ReactNode;
  form: WizardForm;
  /** Подпись главной кнопки; по умолчанию «Дальше». */
  submitLabel?: string;
  /** Кнопка в ожидании не только во время отправки (идёт загрузка фото). */
  busy?: boolean;
  /** Под формой, над доком (сноска последнего шага). */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * Рамка шага: «Назад», «Шаг N из 5» с полосой и единственный `<h1>` (WizardHeader), строка прямой заявки, пояснение,
 * поля и одна главная кнопка в доке. После неудачной проверки фокус — на первое поле с ошибкой (диктор прочитает её
 * текст), у группы карточек — на её первый вариант. Компьютер — колонка формы не шире 560 px по центру; телефон — кнопка
 * над панелью вкладок.
 */
export function WizardFrame({ base, title, lead, form, submitLabel = t.next, busy = false, footer, children }: FrameProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const { attempt, onEdit } = form;
  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input')?.focus();
  }, [attempt]);

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <WizardHeader step={base.index + 1} total={TOTAL_STEPS} title={title} back={base.back} />
          {base.direct !== null && <p className="text-body text-ink">{t.directFor(base.direct)}</p>}
          {lead && <p className="text-body text-muted">{lead}</p>}
        </Stack>
        <form id={WIZARD_FORM} ref={formRef} method="post" onSubmit={form.onSubmit}
          onChange={(event) => {
            const target = event.target as { name?: unknown };
            if (onEdit && typeof target.name === "string") onEdit(target.name);
          }}
          noValidate
        >
          <Stack gap="section">
            {children}
            <FormError error={form.error} />
          </Stack>
        </form>
        {footer}
        <ActionDock>
          <Button type="submit" form={WIZARD_FORM} pending={form.pending || busy}>
            {submitLabel}
          </Button>
        </ActionDock>
      </Stack>
    </div>
  );
}
