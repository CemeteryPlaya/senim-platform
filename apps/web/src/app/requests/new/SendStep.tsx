"use client";

import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { submitRequestAction } from "../actions";
import { FormError, useRunAction } from "../_parts/ActionButton";
import { NextButton, StepForm, type StepFrame } from "./StepForm";

const s = ru.requests.wizard.send;

/** 7. Проверка и отправка: сводка с «Изменить» у каждой строки и одна кнопка «Отправить заявку». */
export function SendStep({
  draftId,
  summary,
  footnote,
  directLabel,
  frame,
}: {
  draftId: string;
  summary: ReactNode;
  footnote: string;
  directLabel: string | null;
  frame: StepFrame;
}) {
  const { run, pending, error } = useRunAction(submitRequestAction, (d) => `/requests/${d.requestId}?sent=1`);
  return (
    <StepForm
      title={s.title}
      lead={directLabel !== null ? s.leadDirect(directLabel) : s.lead}
      frame={frame}
      errors={{}}
      onSubmit={() => void run({ requestId: draftId, step: { screen: "send" } })}
      actions={
        <div className="flex w-full flex-col gap-2 sm:items-end">
          <NextButton pending={pending} label={s.submit} />
          <p className="text-base text-muted">{footnote}</p>
        </div>
      }
    >
      {summary}
      <FormError message={error} />
    </StepForm>
  );
}
