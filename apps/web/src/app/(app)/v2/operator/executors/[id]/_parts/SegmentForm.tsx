"use client";

import { useRef } from "react";
import { ru } from "@/i18n/ru";
import { Button, Card, HiddenField, Section, Select, Stack, TextArea } from "@/kit";
import { FormError } from "../../../../../_shell/FormError";
import { useDecisionDone } from "../../../_parts/decision";
import { useOperatorForm } from "../../../_parts/form";
import { changeSegmentAction } from "../../actions";

const q = ru.app.operatorQueues;
const c = q.executors.card;
const SEGMENTS = ["ECONOMY", "COMFORT", "PREMIUM"] as const;
type Segment = (typeof SEGMENTS)[number];

/**
 * Смена сегмента подтверждённому исполнителю: новый сегмент и причина (в журнал и уведомление). `from` — сегмент, который
 * видит оператор: если его успели сменить, модуль откажет, а не перезапишет. Кнопка вторичная — это не главное действие
 * карточки. После смены — тост и обновлённая карточка (форма монтируется заново по новому сегменту).
 */
export function SegmentForm({ profileId, current }: { profileId: string; current: Segment }) {
  const formRef = useRef<HTMLFormElement>(null);
  const done = useDecisionDone(formRef);
  const form = useOperatorForm(changeSegmentAction, { formRef, onSuccess: () => done(c.segmentChange.done) });
  const others = SEGMENTS.filter((segment) => segment !== current);
  return (
    <Section title={c.segmentChange.title} id="segment">
      <Card>
        <form ref={formRef} onSubmit={form.onSubmit} noValidate>
          <Stack>
            <p className="text-body text-muted">{c.segmentChange.current(q.segments[current])}</p>
            <HiddenField name="profileId" value={profileId} />
            <HiddenField name="from" value={current} />
            <Select label={c.segmentChange.to} name="to" required defaultValue={others[0]} error={form.fieldErrors.to}>
              {others.map((segment) => (
                <option key={segment} value={segment}>
                  {q.segments[segment]}
                </option>
              ))}
            </Select>
            <TextArea label={c.segmentChange.reason} name="reason" required maxLength={500} rows={3} error={form.fieldErrors.reason} />
            <FormError error={form.error} atField={Object.keys(form.fieldErrors).length > 0} />
            <div>
              <Button type="submit" variant="secondary" pending={form.pending}>
                {c.segmentChange.submit}
              </Button>
            </div>
          </Stack>
        </form>
      </Card>
    </Section>
  );
}
