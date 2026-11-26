"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Narrow, PageTitle, RadioCard, RadioGroup, Section, Stack, TextArea, toast } from "@/kit";
import { useClientKey } from "../../../../_shell/client-key";
import { FormError } from "../../../../_shell/FormError";
import { useActionForm } from "../../../../_shell/form";
import { LeaveGuard } from "../../../../_shell/LeaveGuard";
import type { Device } from "@/platform/device";
import { ShowcaseFields, type ShowcaseChoice } from "../showcase/_parts/ShowcaseFields";
import { leaveReviewAction } from "./actions";

const t = ru.app.deal.review;
const FORM = "review-form";
const RATINGS = [5, 4, 3, 2, 1] as const;

type Props = {
  dealId: string;
  dealTitle: string;
  backHref: string;
  /** Выбор «что видно в профиле мастера»: прежний выбор и доступные варианты адреса. */
  showcase: { initial: ShowcaseChoice; addressOptions: readonly ShowcaseChoice["address"][] };
  device: Device;
};

/**
 * Отзыв о мастере: оценка (радио 5…1, «5 — отлично» одной строкой), необязательный текст, пояснение про скрытые имя и контакты.
 * Под оценкой — тот же выбор, что видно в профиле мастера; одна отправка пишет отзыв и выбор. «Оставить отзыв» — главное действие. Двойное нажатие даёт один отзыв (форма занята, модуль отвечает CONFLICT на повтор).
 * После успеха — тост и карточка сделки.
 */
export function ReviewForm({ dealId, dealTitle, backHref, showcase, device }: Props) {
  const router = useRouter();
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<ShowcaseChoice>(showcase.initial);
  const [local, setLocal] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  // Ключ повтора: обрыв связи после записи отзыва и повторная отправка того же не дадут второго отзыва; правка — новая отправка.
  const retry = useClientKey();
  const form = useActionForm(leaveReviewAction, {
    toInput: () => {
      const sent = { dealId, rating: rating ?? 0, text, showcase: choice };
      return { ...sent, clientKey: retry.keyFor(sent) };
    },
    onSuccess: () => {
      retry.done();
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
        <PageTitle title={t.title} back={{ href: backHref, label: dealTitle }} lead={t.lead} />
        <Card>
          <form id={FORM} method="post" onSubmit={submit} noValidate>
            <Stack gap="section">
              <RadioGroup legend={t.ratingLegend} {...(ratingError ? { error: ratingError } : {})}>
                {RATINGS.map((n) => (
                  <RadioCard key={n} name="rating" value={String(n)} label={t.rating(n)} checked={rating === n} onChange={() => setRating(n)} />
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
        <Section title={ru.app.deal.showcase.title}>
          <Card>
            <Stack gap="section">
              <p className="text-sub text-muted">{ru.app.deal.showcase.lead}</p>
              <ShowcaseFields value={choice} onChange={setChoice} addressOptions={showcase.addressOptions} />
            </Stack>
          </Card>
        </Section>
        <LeaveGuard dirty={!done && (rating !== null || text.trim() !== "" || JSON.stringify(choice) !== JSON.stringify(showcase.initial))} device={device} />
        <ActionDock>
          <Button type="submit" form={FORM} disabled={done} pending={form.pending}>
            {t.submit}
          </Button>
        </ActionDock>
      </Stack>
    </Narrow>
  );
}
