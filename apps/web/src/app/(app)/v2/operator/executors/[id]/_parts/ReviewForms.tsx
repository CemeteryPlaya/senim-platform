"use client";

import { useRef } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card, HiddenField, RadioCard, RadioGroup, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../../_shell/FormError";
import { useDecisionDone } from "../../../_parts/decision";
import { useOperatorForm } from "../../../_parts/form";
import { ReasonWindow } from "../../../_parts/ReasonWindow";
import { reviewRegistrationAction } from "../../actions";

const q = ru.app.operatorQueues;
const c = q.executors.card;
const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const;

/**
 * Решение по регистрации: сегмент карточками выбора (по умолчанию «Комфорт») и «Подтвердить регистрацию» — главная
 * кнопка экрана; «Отклонить регистрацию» — тихая кнопка с окном причины. После решения — тост и обновлённая карточка
 * (решения больше нет); повторное решение — отказ модуля (регистрацию уже рассмотрели).
 */
export function ReviewForms({ device, profileId }: { device: Device; profileId: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const done = useDecisionDone(anchor);
  const form = useOperatorForm(reviewRegistrationAction, { onSuccess: () => done(c.review.approved) });
  return (
    <div ref={anchor} className="flex flex-col gap-stack-group">
      <Card>
        <form onSubmit={form.onSubmit} noValidate>
          <Stack>
            <HiddenField name="profileId" value={profileId} />
            <HiddenField name="decision" value="approve" />
            <RadioGroup legend={c.review.segment} error={form.fieldErrors.segment}>
              {SEGMENTS.map((segment) => (
                <RadioCard key={segment} name="segment" value={segment} label={q.segments[segment]} defaultChecked={segment === "COMFORT"} />
              ))}
            </RadioGroup>
            <FormError error={form.error} atField={Boolean(form.fieldErrors.segment)} />
            <Button type="submit" full={device === "mobile"} pending={form.pending}>
              {c.review.approve}
            </Button>
          </Stack>
        </form>
      </Card>
      <div>
        <ReasonWindow device={device} action={reviewRegistrationAction} fields={{ profileId, decision: "reject" }} texts={c.review.reject} onDone={done} />
      </div>
    </div>
  );
}
