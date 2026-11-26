"use client";

import { useRef } from "react";
import { ru } from "@/i18n/ru";
import { Button, HiddenField } from "@/kit";
import type { Device } from "@/platform/device";
import { FormError } from "../../../../_shell/FormError";
import { useDecisionDone } from "../../_parts/decision";
import { useOperatorForm } from "../../_parts/form";
import { ReasonWindow } from "../../_parts/ReasonWindow";
import { resolveRevocationAction } from "../actions";

const t = ru.app.operatorQueues.consents;

/**
 * Решение по заявке на отзыв: «Отзыв исполнен» (вторичная кнопка — карточки равноправны) и рядом, в одну строку, тихая
 * кнопка «Отказать» (окно спросит причину, её человек увидит в «Моих данных»). При крупном шрифте строка переносится.
 */
export function RevocationDecision({ device, revocationId }: { device: Device; revocationId: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const done = useDecisionDone(anchor);
  const form = useOperatorForm(resolveRevocationAction, { onSuccess: () => done(t.completed) });
  return (
    <div ref={anchor} className="flex flex-col gap-stack-group">
      <FormError error={form.error} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <form onSubmit={form.onSubmit} noValidate>
          <HiddenField name="revocationId" value={revocationId} />
          <HiddenField name="decision" value="COMPLETED" />
          <Button type="submit" variant="secondary" pending={form.pending}>
            {t.complete}
          </Button>
        </form>
        <ReasonWindow device={device} action={resolveRevocationAction} fields={{ revocationId, decision: "REFUSED" }} texts={t.refuse} onDone={done} />
      </div>
    </div>
  );
}
