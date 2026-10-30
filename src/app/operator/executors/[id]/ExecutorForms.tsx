"use client";

import { ru } from "@/i18n/ru";
import { Button, Card, RadioCards, Select, Textarea } from "@/ui";
import { FormStatus } from "../../_components/FormStatus";
import { useActionForm } from "../../_components/useActionForm";
import { changeSegmentAction, reviewRegistrationAction } from "../actions";

const t = ru.operator;
const c = t.executors.card;
type Segment = "ECONOMY" | "COMFORT" | "PREMIUM";
const SEGMENTS: Segment[] = ["ECONOMY", "COMFORT", "PREMIUM"];

/** Подтвердить с сегментом или отклонить с причиной — две отдельные формы, у каждой одно действие. */
export function ReviewForms({ profileId }: { profileId: string }) {
  const approve = useActionForm(reviewRegistrationAction);
  const reject = useActionForm(reviewRegistrationAction);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={c.approveTitle}>
        <form onSubmit={approve.onSubmit} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="decision" value="approve" />
          <RadioCards
            label={c.segmentLabel}
            hint={c.segmentHint}
            name="segment"
            defaultValue="COMFORT"
            options={SEGMENTS.map((s) => ({ value: s, label: t.segments[s] }))}
            error={approve.fieldError("segment")}
          />
          <FormStatus error={approve.error} done={approve.done} doneText={c.approved} />
          <Button type="submit" loading={approve.pending}>
            {c.approve}
          </Button>
        </form>
      </Card>
      <Card title={c.rejectTitle}>
        <form onSubmit={reject.onSubmit} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="decision" value="reject" />
          <Textarea label={c.reasonLabel} hint={c.reasonHint} name="reason" required maxLength={500} error={reject.fieldError("reason")} />
          <FormStatus error={reject.error} done={reject.done} doneText={c.rejected} />
          <Button type="submit" variant="danger" loading={reject.pending}>
            {c.reject}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function SegmentForm({ profileId, current }: { profileId: string; current: Segment }) {
  const form = useActionForm(changeSegmentAction, { reset: true });
  return (
    <Card title={c.segmentTitle} description={`${c.currentSegment}: ${t.segments[current]}`}>
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="profileId" value={profileId} />
        <input type="hidden" name="from" value={current} />
        <Select
          label={c.newSegment}
          name="to"
          required
          defaultValue={SEGMENTS.find((s) => s !== current)}
          options={SEGMENTS.filter((s) => s !== current).map((s) => ({ value: s, label: t.segments[s] }))}
          error={form.fieldError("to")}
        />
        <Textarea label={c.changeReason} hint={c.changeReasonHint} name="reason" required maxLength={500} error={form.fieldError("reason")} />
        <FormStatus error={form.error} done={form.done} doneText={c.segmentChanged} />
        <Button type="submit" loading={form.pending} className="self-start">
          {c.changeSegment}
        </Button>
      </form>
    </Card>
  );
}
