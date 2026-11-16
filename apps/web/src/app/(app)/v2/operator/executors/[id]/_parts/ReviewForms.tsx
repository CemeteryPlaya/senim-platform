"use client";

import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card, HiddenField, RadioCard, RadioGroup, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../_shell/FormError";
import type { ActionForm } from "../../../../../_shell/form";
import { useDecisionDone } from "../../../_parts/decision";
import { useOperatorForm } from "../../../_parts/form";
import { ReasonWindow } from "../../../_parts/ReasonWindow";
import { reviewRegistrationAction } from "../../actions";

const q = ru.app.operatorQueues;
const c = q.executors.card;
const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const;
/** Форма подтверждения: кнопка в доке телефона связана с ней через `form=`. */
const REVIEW_FORM = "executor-review-form";

type Review = { profileId: string; form: ActionForm; anchor: RefObject<HTMLDivElement | null>; done: (text: string) => void };
const ReviewContext = createContext<Review | null>(null);

function useReview(): Review {
  const review = useContext(ReviewContext);
  if (review === null) throw new Error("ReviewForms/ReviewSubmit outside ReviewProvider");
  return review;
}

/**
 * Состояние решения по регистрации на весь экран карточки: форма (в карточке «Решение») и её главная кнопка живут в разных
 * местах — на телефоне кнопка в доке внизу экрана (`ActionDock` — последний элемент страницы), на компьютере в карточке.
 * Провайдер оборачивает содержимое страницы; серверная разметка внутри него остаётся серверной.
 */
export function ReviewProvider({ profileId, children }: { profileId: string; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const done = useDecisionDone(anchor);
  const form = useOperatorForm(reviewRegistrationAction, { onSuccess: () => done(c.review.approved) });
  return <ReviewContext.Provider value={{ profileId, form, anchor, done }}>{children}</ReviewContext.Provider>;
}

/** «Подтвердить регистрацию» — главная кнопка экрана: в карточке (компьютер) или в доке (телефон), отправляет форму по `form=`. */
export function ReviewSubmit({ full = false }: { full?: boolean }) {
  const { form } = useReview();
  return (
    <Button type="submit" form={REVIEW_FORM} full={full} pending={form.pending}>
      {c.review.approve}
    </Button>
  );
}

/**
 * Решение по регистрации: сегмент карточками выбора (по умолчанию «Комфорт») и «Подтвердить регистрацию»;
 * «Отклонить регистрацию» — тихая кнопка с окном причины. После решения — тост и обновлённая карточка (решения больше нет);
 * повторное решение — отказ модуля (регистрацию уже рассмотрели). На телефоне главной кнопки в карточке нет — она в доке.
 */
export function ReviewForms({ device }: { device: Device }) {
  const { profileId, form, anchor, done } = useReview();
  return (
    <div ref={anchor} className="flex flex-col gap-stack-group">
      <Card>
        <form id={REVIEW_FORM} onSubmit={form.onSubmit} noValidate>
          <Stack>
            <HiddenField name="profileId" value={profileId} />
            <HiddenField name="decision" value="approve" />
            <RadioGroup legend={c.review.segment} error={form.fieldErrors.segment}>
              {SEGMENTS.map((segment) => (
                <RadioCard key={segment} name="segment" value={segment} label={q.segments[segment]} defaultChecked={segment === "COMFORT"} />
              ))}
            </RadioGroup>
            <FormError error={form.error} atField={Boolean(form.fieldErrors.segment)} />
            {device === "desktop" && <ReviewSubmit />}
          </Stack>
        </form>
      </Card>
      <div>
        <ReasonWindow device={device} action={reviewRegistrationAction} fields={{ profileId, decision: "reject" }} texts={c.review.reject} onDone={done} />
      </div>
    </div>
  );
}
