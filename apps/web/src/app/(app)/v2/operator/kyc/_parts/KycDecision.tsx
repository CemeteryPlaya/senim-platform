"use client";

import { useRef } from "react";
import { ru } from "@/i18n/ru";
import { Button, HiddenField, Stack } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useDecisionDone } from "../../_parts/decision";
import { useOperatorForm } from "../../_parts/form";
import { ReasonWindow } from "../../_parts/ReasonWindow";
import { reviewKycAction } from "../actions";

const t = ru.app.operatorQueues.kyc;

/**
 * Решение по документам мастера: «Документы в порядке» (вторичная кнопка — карточки очереди равноправны) и тихая кнопка
 * «Отклонить документы» (окно с причиной). Обе формы несут время подачи из очереди: мастер прислал новые документы —
 * решение по старым не пройдёт.
 */
export function KycDecision({ device, userId, submittedAt }: { device: Device; userId: string; submittedAt: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const done = useDecisionDone(anchor);
  const form = useOperatorForm(reviewKycAction, { onSuccess: () => done(t.verified) });
  return (
    <div ref={anchor} className="flex flex-col gap-stack-group">
      <form onSubmit={form.onSubmit} noValidate>
        <Stack>
          <HiddenField name="userId" value={userId} />
          <HiddenField name="submittedAt" value={submittedAt} />
          <HiddenField name="decision" value="VERIFIED" />
          <FormError error={form.error} />
          <div>
            <Button type="submit" variant="secondary" pending={form.pending}>
              {t.verify}
            </Button>
          </div>
        </Stack>
      </form>
      <div>
        <ReasonWindow device={device} action={reviewKycAction} fields={{ userId, submittedAt, decision: "REJECTED" }} texts={t.reject} onDone={done} />
      </div>
    </div>
  );
}
