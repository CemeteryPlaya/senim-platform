"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, Input, RadioCards, Textarea } from "@/ui";
import { FormStatus } from "../../_components/FormStatus";
import { useActionForm } from "../../_components/useActionForm";
import { resolveDisputeAction } from "../actions";

const t = ru.operator.disputes;
const c = t.card;
const DECISIONS = ["FAVOR_CLIENT", "FAVOR_EXECUTOR", "PARTIAL", "TERMINATE"] as const;
type Decision = (typeof DECISIONS)[number];

/** Решение по структуре спора: исход, сумма (только для частичного), обоснование. */
export function ResolveForm({ disputeId, maxAmount }: { disputeId: string; maxAmount: number }) {
  const [decision, setDecision] = useState<Decision>("FAVOR_CLIENT");
  const form = useActionForm(resolveDisputeAction);

  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="disputeId" value={disputeId} />
      <RadioCards
        label={c.decisionLabel}
        name="decision"
        value={decision}
        onChange={(v) => setDecision(DECISIONS.find((d) => d === v) ?? "FAVOR_CLIENT")}
        options={DECISIONS.map((d) => ({ value: d, label: t.decisions[d], description: t.decisionHints[d] }))}
        columns={2}
        error={form.fieldError("decision")}
      />
      {decision === "PARTIAL" && (
        <Input
          label={c.amountLabel}
          hint={c.amountHint}
          name="decisionAmount"
          type="number"
          inputMode="numeric"
          min={1}
          max={maxAmount}
          required
          error={form.fieldError("decisionAmount")}
        />
      )}
      <Textarea label={c.rationaleLabel} hint={c.rationaleHint} name="rationale" required maxLength={2000} rows={5} error={form.fieldError("rationale")} />
      <FormStatus error={form.error} done={form.done} doneText={c.resolved} />
      <Button type="submit" loading={form.pending} className="self-start">
        {c.submit}
      </Button>
    </form>
  );
}
