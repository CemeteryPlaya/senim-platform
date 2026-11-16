"use client";

import { useEffect, useRef, type FormEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Notice, Stack, toast, WizardHeader } from "@/kit";
import { WIZARD_SCREENS, type WizardScreen } from "@/modules/requests/client";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { saveStepAction } from "./actions";
import { readStep, stepErrors, TOTAL_STEPS } from "./steps";
import { forgetStep } from "./wizard-memory";

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
  /** Подпись мастера прямой заявки из модуля («Исполнитель №N» по режиму показа имени) или `null`. */
  direct: string | null;
};

export type WizardForm = {
  pending: boolean;
  /** Общая ошибка (отказ модуля) или `null`. */
  error: string | null;
  /** Ошибки у полей: проверка схемой шага в браузере и ответ сервера; без поля — ключ `form`. */
  errors: Record<string, string>;
  /** Форма шага (хук ведёт по ней фокус к ошибке и снятие ошибки при правке); без неё рамка берёт свою. */
  formRef?: RefObject<HTMLFormElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** «Назад» сохраняет шаг и ведёт на прошлый (шаг фото); без него «Назад» — обычная ссылка. */
  onBack?: (form: HTMLFormElement) => void;
};

/**
 * Форма шага «Дальше»: поля проверяет та же схема шага, что и сервер (ошибки сразу у полей, запрос не уходит), затем
 * `saveStepAction` сохраняет черновик и ведёт на следующий шаг; несохранённый ввод шага (sessionStorage) после этого
 * забывается. Повторное нажатие, пока идёт сохранение или переход, гасит `useActionForm` (один эффект). `blocked` —
 * отправлять рано (идёт загрузка фото): `onBlocked` объясняет почему. `saveOnBack` — «Назад» тоже сохраняет шаг (шаг фото:
 * загруженные фото иначе потерялись бы) и ведёт на прошлый.
 */
export function useWizardStep(
  screen: WizardScreen,
  base: WizardBase,
  options: { blocked?: { when: boolean; onBlocked: () => void }; saveOnBack?: boolean } = {},
): WizardForm {
  const formRef = useRef<HTMLFormElement>(null);
  const form = useActionForm(saveStepAction, {
    formRef,
    // Тип мебели собирается из трёх полей: правка любого из них снимает ошибку выбора типа; правка любого поля — общую ошибку шага.
    clears: (name) => (["furnitureType", "furnitureTypeOther", "customType"].includes(name) ? ["furnitureTypeId", "customType", "form"] : ["form"]),
    toInput: (fd) => {
      const goto = fd.get("goto");
      return {
        requestId: base.draftId,
        like: base.draftId ? null : base.like,
        executor: base.draftId ? null : base.executor,
        step: readStep(screen, fd),
        ...(typeof goto === "string" ? { goto: goto as WizardScreen } : {}),
      };
    },
  });

  /** Проверить и сохранить шаг; `goto` — куда потом (по умолчанию — следующий шаг). */
  function save(fd: FormData, goto?: WizardScreen) {
    if (options.blocked?.when) return options.blocked.onBlocked();
    const found = stepErrors(screen, fd);
    if (found) {
      form.reject(found);
      return;
    }
    forgetStep(base.draftId, screen);
    if (goto) fd.set("goto", goto);
    void form.submit(fd);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save(new FormData(event.currentTarget));
  }

  const previous = base.index > 0 ? WIZARD_SCREENS[base.index - 1] : null;
  const onBack = options.saveOnBack && previous && base.draftId ? (el: HTMLFormElement) => save(new FormData(el), previous) : undefined;
  return { pending: form.pending, error: form.error, errors: form.fieldErrors, formRef, onSubmit, onBack };
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
 * поля, общая ошибка над кнопкой и одна главная кнопка в доке. После неудачной проверки фокус — на первое поле с ошибкой
 * (диктор прочитает её текст), у группы карточек — на её первый вариант. Тосты прошлого шага закрываются при открытии
 * этого. Компьютер — колонка формы не шире 560 px по центру; телефон — кнопка над панелью вкладок.
 */
export function WizardFrame({ base, title, lead, form, submitLabel = t.next, busy = false, footer, children }: FrameProps) {
  const ownRef = useRef<HTMLFormElement>(null);
  const formRef = form.formRef ?? ownRef;
  const { onBack } = form;
  useEffect(() => {
    toast.dismiss();
  }, []);

  /** «Назад» шапки — ссылка kit; когда шаг сохраняется и на «Назад», обычный переход заменяется сохранением. */
  function interceptBack(event: MouseEvent<HTMLDivElement>) {
    if (!onBack || !formRef.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a");
    if (!link || link.getAttribute("href") !== base.back.href) return;
    event.preventDefault();
    onBack(formRef.current);
  }

  return (
    <div className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          {/* Перехват нажатия на ссылку «Назад» внутри шапки (клавиатура даёт то же событие click). */}
          <div onClickCapture={interceptBack}>
            <WizardHeader step={base.index + 1} total={TOTAL_STEPS} title={title} back={base.back} />
          </div>
          {base.direct !== null && <p className="text-body text-ink">{t.directFor(base.direct)}</p>}
          {lead && <p className="text-body text-muted">{lead}</p>}
        </Stack>
        <form
          id={WIZARD_FORM}
          ref={formRef}
          method="post"
          onSubmit={form.onSubmit}
          noValidate
        >
          <Stack gap="section">
            {children}
            {form.errors.form && (
              <Notice tone="danger" live>
                {form.errors.form}
              </Notice>
            )}
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
