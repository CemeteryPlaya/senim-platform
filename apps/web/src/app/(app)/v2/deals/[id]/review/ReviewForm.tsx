"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Narrow, NowNext, PageTitle, RadioCard, RadioGroup, Stack, TextArea, toast } from "@/kit";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { LeaveGuard } from "../../../../_shell/LeaveGuard";
import type { Device } from "@/platform/device";
import { leaveReviewAction } from "./actions";

const t = ru.app.deal.review;
const FORM = "review-form";
const RATINGS = [5, 4, 3, 2, 1] as const;

type Props = { dealId: string; dealTitle: string; number: number; backHref: string; device: Device };

/**
 * Отзыв о мастере: оценка (радио 5…1 с подписью словами), необязательный текст, пояснение про скрытые имя и контакты.
 * «Оставить отзыв» — главное действие. Двойное нажатие даёт один отзыв (форма занята, модуль отвечает CONFLICT на повтор).
 * После успеха — тост и карточка сделки.
 */
export function ReviewForm({ dealId, dealTitle, number, backHref, device }: Props) {
  const router = useRouter();
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [local, setLocal] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const form = useActionForm(leaveReviewAction, {
    toInput: () => ({ dealId, rating: rating ?? 0, text }),
    onSuccess: () => {
      setDone(true);
      toast(t.sent);
      router.replace(backHref);
    },
  });
  const ratingError = local ?? form.fieldErrors.rating;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating === null) {
      setLocal(t.errors.rating);
      return;
    }
    setLocal(undefined);
    void form.submit(new FormData());
  }

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: backHref, label: dealTitle }} lead={t.lead(number)} />
        <NowNext now={{ title: t.intro }} />
        <Card>
          <form id={FORM} method="post" onSubmit={submit} noValidate>
            <Stack gap="section">
              <RadioGroup legend={t.ratingLegend} {...(ratingError ? { error: ratingError } : {})}>
                {RATINGS.map((n) => (
                  <RadioCard key={n} name="rating" value={String(n)} label={t.rating(n)} description={t.ratingText[n]} checked={rating === n} onChange={() => setRating(n)} />
                ))}
              </RadioGroup>
              <Stack>
                <TextArea label={t.textLabel} name="text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={4} {...(form.fieldErrors.text ? { error: form.fieldErrors.text } : {})} />
                <p className="text-sub text-muted">{t.privacy}</p>
              </Stack>
              <FormError error={form.error} />
            </Stack>
          </form>
        </Card>
        <LeaveGuard dirty={!done && (rating !== null || text.trim() !== "")} device={device} />
        <ActionDock>
          <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </Narrow>
  );
}
