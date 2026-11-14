"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Stack, WizardHeader } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../_shell/FormError";
import { useActionForm } from "../../../_shell/form";
import { registerMasterAction } from "./actions";
import { errorsOf, firstInvalidStep, stepIssues, stepOfField, STEP_FIELDS, STEPS, type AnswerField, type Answers, type RegisterStep } from "./_parts/schema";
import { backOf, persistable, prefillSigner, restoreAnswers, stepHref, type Origin } from "./_parts/steps";
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
export function RegisterWizard({ step: requested, initial, origin, ownIinLast4, fullName, keepsBuyer, storageKey, device }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState(initial);
  const [restored, setRestored] = useState(false);
  /** Ошибки проверки в браузере. */
  const [invalid, setInvalid] = useState<StepErrors>({});
  /** Поля, исправленные после ответа сервера: его ошибка у них больше не показывается. */
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  /** Номер неудачной проверки: по нему фокус уходит на первое поле с ошибкой. */
  const [attempt, setAttempt] = useState(0);
  const form = useActionForm(registerMasterAction, { toInput: () => answers });

  // Восстановление после гидратации, в следующем кадре: на сервере хранилища нет, и подставь его первый проход — разметка
  // разошлась бы с серверной.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = readSaved(storageKey);
      if (saved !== null) setAnswers((current) => restoreAnswers(current, saved));
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

  // Ошибки сервиса у полей: открыть шаг первой из них.
  const serverErrors = form.fieldErrors;
  useEffect(() => {
    const first = Object.keys(serverErrors)
      .map(stepOfField)
      .filter((s): s is RegisterStep => s !== null)
      .sort((x, y) => STEPS.indexOf(x) - STEPS.indexOf(y))[0];
    if (first) router.push(stepHref(first));
  }, [serverErrors, router]);

  const root = useRef<HTMLDivElement>(null);
  // Смена шага — фокус на первое поле нового шага (первый показ — без фокуса).
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    root.current?.querySelector<HTMLElement>("form input")?.focus();
  }, [step]);
  // Неудачная проверка или ответ сервера с ошибками у полей — фокус на первое поле с ошибкой (у группы карточек — на её
  // первый вариант); после перехода на шаг с ошибкой — там.
  useEffect(() => {
    if (attempt === 0 && Object.keys(serverErrors).length === 0) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input')?.focus();
  }, [attempt, serverErrors, step]);

  const errors: StepErrors = { ...visibleServerErrors(serverErrors, edited), ...invalid };

  function change(field: AnswerField, value: string) {
    setAnswers((current) => ({ ...current, [field]: value }));
    setEdited((current) => new Set(current).add(field));
    if (field in invalid) setInvalid((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)));
  }

  /** Проверка шага; ошибки — у полей и фокус на первое. */
  function check(at: RegisterStep): boolean {
    const issues = stepIssues(at, answers);
    if (issues.length === 0) {
      setInvalid({});
      return true;
    }
    setInvalid(errorsOf(issues));
    setAttempt((n) => n + 1);
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
      setInvalid(errorsOf(stepIssues(STEPS[firstBad], answers)));
      setAttempt((n) => n + 1);
      router.push(stepHref(STEPS[firstBad]));
      return;
    }
    setEdited(new Set());
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
        <form id={FORM} method="post" onSubmit={onSubmit} noValidate>
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

/** Ошибки сервиса у полей анкеты, кроме исправленных после ответа. */
function visibleServerErrors(serverErrors: Record<string, string>, edited: ReadonlySet<string>): StepErrors {
  return Object.fromEntries(Object.entries(serverErrors).filter(([field]) => ANSWER_FIELDS.has(field) && !edited.has(field)));
}

/** Текст общей ошибки уже стоит у поля анкеты — второй раз его не показывать. */
const hasFieldError = (serverErrors: Record<string, string>): boolean => Object.keys(serverErrors).some((field) => ANSWER_FIELDS.has(field));
