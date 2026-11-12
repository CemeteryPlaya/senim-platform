"use client";

import { ru } from "@/i18n/ru";
import { Button, Textarea } from "@/ui";
import { useQueueDecision } from "../_components/DecisionQueue";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { resolveRevocationAction } from "./actions";

const t = ru.operator.consents;

/**
 * Решение по заявке на отзыв: «Отзыв исполнен» и, свёрнуто, отказ с причиной. Карточки очереди равноправны — заливной
 * кнопки на экране нет, обе — обводкой.
 */
export function ResolveForm({ revocationId }: { revocationId: string }) {
  // В очереди карточка после решения исчезает: итог объявляет очередь, а не форма.
  const decided = useQueueDecision();
  const complete = useActionForm(resolveRevocationAction, { onSuccess: (_, el) => decided?.(t.completed, el) });
  const refuse = useActionForm(resolveRevocationAction, { onSuccess: (_, el) => decided?.(t.refused, el) });
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={complete.onSubmit} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="revocationId" value={revocationId} />
        <input type="hidden" name="decision" value="COMPLETED" />
        <FormStatus error={complete.error} done={complete.done && !decided} doneText={t.completed} />
        <Button type="submit" variant="secondary" loading={complete.pending} className="self-start">
          {t.complete}
        </Button>
      </form>
      <details className="rounded-control border border-line p-4">
        <summary className="min-h-control cursor-pointer content-center text-base font-semibold text-ink">{t.refuse}</summary>
        <form onSubmit={refuse.onSubmit} noValidate className="flex flex-col gap-4 pt-4">
          <input type="hidden" name="revocationId" value={revocationId} />
          <input type="hidden" name="decision" value="REFUSED" />
          <Textarea label={t.reason} hint={t.reasonHint} name="reason" required maxLength={500} rows={3} error={refuse.fieldError("reason")} />
          <FormStatus error={refuse.error} done={refuse.done && !decided} doneText={t.refused} />
          <Button type="submit" variant="secondary" loading={refuse.pending} className="self-start">
            {t.refuse}
          </Button>
        </form>
      </details>
    </div>
  );
}
