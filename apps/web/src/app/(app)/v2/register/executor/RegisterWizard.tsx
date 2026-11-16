"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Notice, Stack, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { registerMasterAction } from "./actions";
import { errorsOf, firstInvalidStep, stepIssues, stepOfField, STEP_FIELDS, STEPS, type AnswerField, type Answers, type RegisterStep } from "./_parts/schema";
import { backOf, initialAnswers, persistable, prefillSigner, restoreAnswers, stepHref, type Origin } from "./_parts/steps";
import { CheckSummary, FormFields, NameFields, PlaceFields, StepExplain, type StepErrors } from "./RegisterSteps";

const t = ru.app.masterRegister;

/** id формы шага: кнопка дока стоит вне формы и связана с ней атрибутом `form`. */
const FORM = "master-register";

// Хранилище вкладки (sessionStorage): анкета без БИН и ИИН директора переживает перезагрузку; недоступно — работа без него.
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readSaved(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, answers: Answers): void {
  try {
    storage()?.setItem(key, JSON.stringify(persistable(answers)));
  } catch {
    // Нет места или хранилище запрещено: введённое просто не переживёт перезагрузку.
  }
}

function forgetSaved(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Нечего забывать.
  }
}

type Props = {
  /** Шаг из адреса (`?step=`); без шага — первый. */
  step: RegisterStep | null;
  /** Начальные значения: пустая анкета или, после отказа, прежние форма работы и наименование. */
  initial: Answers;
  origin: Origin;
  /** Повторная анкета после отказа: причина отказа (плашкой на первом и последнем шаге) или `null`. */
  rejectReason?: string | null;
  /** Последние 4 цифры ИИН из знакомства (самозанятый и ИП работают по нему). */
  ownIinLast4: string | null;
  /** ФИО из знакомства: подставляется в наименование самозанятого и владельца ИП. */
  fullName: string | null;
  /** Покупатель становится мастером: пояснение на первом шаге. */
  keepsBuyer: boolean;
  /** Ключ хранилища вкладки (свой у каждого пользователя). */
  storageKey: string;
  device: Device;
};

/**
 * Анкета мастера: четыре шага одного адреса (`?step=form|name|place|check`). Ответы живут в памяти страницы: переход между
 * шагами — по адресу той же страницы (как вход), состояние клиентского компонента сохраняется; «Назад» шапки и «Назад»
 * браузера ведут на прошлый шаг. Перезагрузку переживает всё, кроме БИН и ИИН директора (их нет ни в адресе, ни в
 * хранилище вкладки). Шаг дальше первого незаполненного не открывается — адрес заменяется на него.
 *
 * «Дальше» проверяет шаг той же проверкой, что и сервер (ошибки сразу у полей, фокус на первое поле с ошибкой). Последний
 * шаг отправляет анкету целиком (`registerMasterAction`); ошибки сервиса приходят у полей — анкета открывает шаг с первой из
 * них. Повторное нажатие, пока идёт отправка, гасит `useActionForm`; сервер на повтор отвечает экраном статуса.
 */
export function RegisterWizard({ step: requested, initial, origin, rejectReason = null, ownIinLast4, fullName, keepsBuyer, storageKey, device }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initial);
  const [restored, setRestored] = useState(false);
  /** Из хранилища восстановлена анкета ТОО: номеров там нет — их нужно ввести снова (плашка на шаге 2). */
  const [numbersDropped, setNumbersDropped] = useState(false);
  const formEl = useRef<HTMLFormElement>(null);
  // Ошибки проверки в браузере и ответа сервера — одни (`form.fieldErrors`): фокус на первое поле и снятие ошибки при
  // правке поля делает useActionForm.
  const form = useActionForm(registerMasterAction, { formRef: formEl, toInput: () => answers });

  // Восстановление после гидратации, в следующем кадре: на сервере хранилища нет, и подставь его первый проход — разметка
  // разошлась бы с серверной.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = readSaved(storageKey);
      if (saved !== null) {
        setAnswers((current) => restoreAnswers(current, saved));
        setNumbersDropped(restoreAnswers(initialAnswers(), saved).legalForm === "TOO");
      }
      setRestored(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);

  // Каждое изменение — в хранилище; во время отправки анкета забыта (успех уводит на статус, ошибка вернёт её на место).
  useEffect(() => {
    if (!restored) return;
    if (form.pending) forgetSaved(storageKey);
    else writeSaved(storageKey, answers);
  }, [answers, restored, form.pending, storageKey]);

  const wanted = STEPS.indexOf(requested ?? "form");
  const index = restored ? Math.min(wanted, firstInvalidStep(answers)) : wanted;
  const step = STEPS[index];

  // Шаг дальше незаполненного (перезагрузка без БИН, чужая ссылка) — адрес приводится к открытому шагу.
  useEffect(() => {
    if (restored && index < wanted) router.replace(stepHref(STEPS[index]));
  }, [restored, index, wanted, router]);

  // Ошибки у полей (сервис или проверка всей анкеты на последнем шаге): открыть шаг первой из них, если это не текущий.
  const serverErrors = form.fieldErrors;
  useEffect(() => {
    const first = Object.keys(serverErrors)
      .map(stepOfField)
      .filter((s): s is RegisterStep => s !== null)
      .sort((x, y) => STEPS.indexOf(x) - STEPS.indexOf(y))[0];
    if (first && first !== step) router.push(stepHref(first));
    // Только когда ошибки появились: уход человека на другой шаг не возвращает его к ним.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverErrors, router]);

  const root = useRef<HTMLDivElement>(null);
  // Смена шага — фокус на поле с ошибкой (если пришли сюда за ней), иначе на выбранную карточку или первое поле нового шага;
  // на шаге без полей — на заголовок (первый показ — без фокуса).
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const field =
      root.current?.querySelector<HTMLElement>('form [aria-invalid="true"], form fieldset[aria-describedby] input') ??
      root.current?.querySelector<HTMLElement>("form input:checked") ??
      root.current?.querySelector<HTMLElement>("form input");
    if (field) return field.focus();
    const heading = root.current?.querySelector<HTMLElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [step]);
  const errors: StepErrors = answerErrors(serverErrors);

  function change(field: AnswerField, value: string) {
    setAnswers((current) => ({ ...current, [field]: value }));
  }

  /** Проверка шага; ошибки — у полей и фокус на первое. */
  function check(at: RegisterStep): boolean {
    const issues = stepIssues(at, answers);
    if (issues.length === 0) return true;
    form.reject(errorsOf(issues));
    return false;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "check") {
      if (!check(step)) return;
      if (step === "form") setAnswers((current) => prefillSigner(current, fullName));
      router.push(stepHref(STEPS[index + 1]));
      return;
    }
    // Последний шаг: сначала вся анкета; ошибка — на шаг с ней.
    const firstBad = firstInvalidStep(answers);
    if (firstBad < STEPS.length - 1) {
      form.reject(errorsOf(stepIssues(STEPS[firstBad], answers)));
      return;
    }
    void form.submit(new FormData());
  }

  const fields = { answers, errors, onChange: change };
  return (
    // Компьютер — одна колонка формы не шире 560 px по центру; телефон — кнопка в доке над панелью вкладок.
    <div ref={root} className="desktop:mx-auto desktop:max-w-narrow">
      <Stack gap="section">
        <Stack gap="tight">
          <WizardHeader step={index + 1} total={STEPS.length} title={t.steps[step]} back={backOf(step, origin)} />
          {step === "form" && <p className="text-body text-muted">{t.form.lead}</p>}
          {step === "form" && keepsBuyer && <p className="text-body text-ink">{t.form.keepsBuyer}</p>}
          {step === "form" && <StepExplain kind="form" device={device} />}
          {step === "name" && <StepExplain kind="name" device={device} />}
          {step === "place" && <p className="text-body text-muted">{t.place.lead}</p>}
          {step === "check" && <p className="text-body text-muted">{t.check.lead}</p>}
        </Stack>
        {origin === "status" && (step === "form" || step === "check") && (
          <Notice tone="warn" title={t.status.rejected.againTitle}>
            <p>{rejectReason ? t.status.rejected.reason(rejectReason) : t.status.rejected.noReason}</p>
          </Notice>
        )}
        {step === "name" && numbersDropped && answers.legalForm === "TOO" && (answers.binIin === "" || answers.directorIin === "") && (
          <Notice tone="info">{t.name.numbersNotSaved}</Notice>
        )}
        <form id={FORM} ref={formEl} method="post" onSubmit={onSubmit} noValidate>
          <Stack gap="section">
            {step === "form" && <FormFields {...fields} />}
            {step === "name" && <NameFields {...fields} ownIinLast4={ownIinLast4} />}
            {step === "place" && <PlaceFields {...fields} />}
            {step === "check" && <CheckSummary answers={answers} ownIinLast4={ownIinLast4} />}
            <FormError error={form.error} atField={hasFieldError(serverErrors)} />
          </Stack>
        </form>
        <ActionDock>
          <Button type="submit" form={FORM} pending={form.pending}>
            {step === "check" ? t.submit : t.next}
          </Button>
        </ActionDock>
      </Stack>
    </div>
  );
}

const ANSWER_FIELDS = new Set<string>(Object.values(STEP_FIELDS).flat());

/** Ошибки у полей анкеты (ответ сервиса и проверка шага). */
function answerErrors(errors: Record<string, string>): StepErrors {
  return Object.fromEntries(Object.entries(errors).filter(([field]) => ANSWER_FIELDS.has(field)));
}

/** Текст общей ошибки уже стоит у поля анкеты — второй раз его не показывать. */
const hasFieldError = (serverErrors: Record<string, string>): boolean => Object.keys(serverErrors).some((field) => ANSWER_FIELDS.has(field));
