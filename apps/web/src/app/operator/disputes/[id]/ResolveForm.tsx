"use client";

import { useState, useTransition } from "react";
import { leaveIfSignedOut } from "@/modules/identity/client";
import { ru } from "@/i18n/ru";
import { Alert, Button, Fact, Input, RadioCards, Textarea } from "@/ui";
import { FormStatus } from "../../_components/FormStatus";
import { useActionForm } from "../../_components/useActionForm";
import { previewSplitAction, resolveDisputeAction } from "../actions";

const t = ru.operator.disputes;
const c = t.card;
const OUTCOMES = ["CONTINUE", "FULL_REFUND", "PARTIAL_SPLIT"] as const;
type Outcome = (typeof OUTCOMES)[number];
type Preview = { master: string; platform: string; refund: string };

/** Расчёт раздела заранее: сервер считает payments.computeSplit — формула не дублируется в браузере. */
function SplitPreview({ disputeId, share }: { disputeId: string; share: string }) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const calc = () =>
    startTransition(async () => {
      const result = await previewSplitAction({ disputeId, masterShareKzt: share });
      if (result.ok) {
        setPreview(result.data);
        setError(undefined);
      } else if (!leaveIfSignedOut(result)) {
        setPreview(undefined);
        setError(result.fieldErrors?.masterShareKzt?.[0] ?? result.error);
      }
    });
  return (
    <section aria-label={c.preview} aria-live="polite" className="flex flex-col gap-3 rounded-card border border-line bg-sunken p-4">
      <Button type="button" variant="secondary" loading={pending} onClick={calc} className="self-start">
        {c.previewButton}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
      {preview ? (
        <dl className="flex flex-col gap-3">
          <Fact label={c.previewMaster}>{preview.master}</Fact>
          <Fact label={c.previewPlatform}>{preview.platform}</Fact>
          <Fact label={c.previewRefund}>{preview.refund}</Fact>
        </dl>
      ) : (
        !error && <p className="text-base text-muted">{c.previewWaiting}</p>
      )}
    </section>
  );
}

/** Решение по спору (ADR-009 раздел 3): итог, сумма мастеру для раздела, обоснование — обязательно. */
export function ResolveForm({ disputeId, maxShare }: { disputeId: string; maxShare: string }) {
  const [outcome, setOutcome] = useState<Outcome>("CONTINUE");
  const [share, setShare] = useState("");
  const form = useActionForm(resolveDisputeAction);

  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="disputeId" value={disputeId} />
      <RadioCards
        label={c.outcomeLabel}
        name="outcome"
        value={outcome}
        onChange={(v) => setOutcome(OUTCOMES.find((o) => o === v) ?? "CONTINUE")}
        options={OUTCOMES.map((o) => ({ value: o, label: t.outcomes[o], description: t.outcomeHints[o] }))}
        error={form.fieldError("outcome")}
      />
      {outcome === "PARTIAL_SPLIT" && (
        <>
          <Input
            label={c.shareLabel}
            hint={c.shareHint(maxShare)}
            name="masterShareKzt"
            inputMode="numeric"
            autoComplete="off"
            required
            value={share}
            onChange={(e) => setShare(e.target.value)}
            error={form.fieldError("masterShareKzt") ?? form.fieldError("masterShareTiyn")}
          />
          <SplitPreview disputeId={disputeId} share={share} />
        </>
      )}
      <Textarea label={c.rationaleLabel} hint={c.rationaleHint} name="rationale" required maxLength={2000} rows={5} error={form.fieldError("rationale")} />
      <FormStatus error={form.error} done={form.done} doneText={c.resolved} />
      <Button type="submit" loading={form.pending} className="self-start">
        {c.submit}
      </Button>
    </form>
  );
}
