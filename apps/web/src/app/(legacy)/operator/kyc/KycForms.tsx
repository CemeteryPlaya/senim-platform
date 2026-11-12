"use client";

import { ru } from "@/i18n/ru";
import { Button, Textarea } from "@/ui";
import { useQueueDecision } from "../_components/DecisionQueue";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { reviewKycAction } from "./actions";

const t = ru.operator.kyc;

/**
 * Решение по KYC: «Документы в порядке» и, свёрнуто, отказ с причиной. Карточки очереди равноправны — заливной
 * кнопки на экране нет, «Документы в порядке» — обводкой. Обе формы несут время подачи из очереди: мастер прислал новые
 * документы — решение по старым не пройдёт.
 */
export function KycForms({ userId, submittedAt }: { userId: string; submittedAt: string }) {
  // В очереди карточка после решения исчезает: итог объявляет очередь, а не форма.
  const decided = useQueueDecision();
  const verify = useActionForm(reviewKycAction, { onSuccess: (_, el) => decided?.(t.verified, el) });
  const reject = useActionForm(reviewKycAction, { onSuccess: (_, el) => decided?.(t.rejected, el) });
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={verify.onSubmit} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="submittedAt" value={submittedAt} />
        <input type="hidden" name="decision" value="VERIFIED" />
        <FormStatus error={verify.error} done={verify.done && !decided} doneText={t.verified} />
        <Button type="submit" variant="secondary" loading={verify.pending} className="self-start">
          {t.verify}
        </Button>
      </form>
      <details className="rounded-control border border-line p-4">
        <summary className="min-h-control cursor-pointer content-center text-base font-semibold text-ink">{t.reject}</summary>
        <form onSubmit={reject.onSubmit} noValidate className="flex flex-col gap-4 pt-4">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="submittedAt" value={submittedAt} />
          <input type="hidden" name="decision" value="REJECTED" />
          <Textarea label={t.reason} hint={t.reasonHint} name="reason" required maxLength={500} rows={3} error={reject.fieldError("reason")} />
          <FormStatus error={reject.error} done={reject.done && !decided} doneText={t.rejected} />
          <Button type="submit" variant="secondary" loading={reject.pending} className="self-start">
            {t.reject}
          </Button>
        </form>
      </details>
    </div>
  );
}
