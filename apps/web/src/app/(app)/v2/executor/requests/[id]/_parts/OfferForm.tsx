"use client";

import { useRouter } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, HiddenField, MoneyField, Money, Notice, Section, Stack, TextArea, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { useActionForm } from "../../../../../_shell/form";
import { draftKey, useFormDraft } from "../../../../../_shell/form-draft";
import { sendOfferAction } from "../actions";
import { formMoney, liveMoney } from "./live-money";
import { MasterMoney } from "./MasterMoney";
import { COMMENT_MAX } from "./schema";
import { kztToTiyn } from "@/modules/payments/client";

const t = ru.app.masterOffer;

/** Форма одна на экране: кнопка в доке связана с ней атрибутом `form`. */
const FORM_ID = "master-offer-form";

/** Пустая форма: гарантия по умолчанию — как в форме v1 (12 месяцев), мастер меняет её сам. */
const EMPTY = { price: "", days: "", warranty: "12", comment: "" };

/**
 * Форма предложения: цена, срок, гарантия, комментарий; под ними — живой расчёт «Вы получите» крупно, под ним «Цена
 * покупателю» и «Гарантия оплаты и клиента (6%)» по введённой цене (`formMoney`: та же формула, что у модуля, итог на сервере —
 * `partyEstimate("EXECUTOR")`). Главное действие «Отправить предложение» — в `ActionDock` последним (связь с формой —
 * атрибутом `form`): на телефоне док прилипает над панелью вкладок, поэтому форма ставится последней в колонке экрана.
 * Ошибки — у полей, введённое сохраняется; двойное нажатие — один вызов (useActionForm). После отправки — тост и экран
 * в состоянии «ждём ответа покупателя». Введённое (цена, срок, гарантия, комментарий) — черновик в sessionStorage по id
 * заявки: уход и возвращение его не стирают, после отправки он забывается.
 */
export function OfferForm({ requestId, device }: { requestId: string; device: Device }) {
  const router = useRouter();
  const draft = useFormDraft(draftKey("offer", requestId), EMPTY);
  const { values } = draft;
  const price = values.price;
  const form = useActionForm(sendOfferAction, {
    onSuccess: () => {
      draft.clear();
      toast(t.toasts.sent);
      router.refresh();
    },
  });
  const money = formMoney(price);
  const live = liveMoney(price);
  const shown = new Set(Object.keys(form.fieldErrors));
  const general = form.error && !["price", "days", "warranty", "comment"].some((name) => shown.has(name));
  return (
    <>
      <Section title={t.form.title}>
        <Card>
          <form id={FORM_ID} onSubmit={form.onSubmit} noValidate>
            <Stack>
              <HiddenField name="requestId" value={requestId} />
              <MoneyField
                label={t.form.price}
                name="price"
                enterKeyHint="next"
                key={`price-${draft.restored}`}
                defaultTiyn={price === "" ? null : kztToTiyn(Number(price))}
                onValueChange={(tiyn) => draft.set({ price: tiyn === null ? "" : (tiyn / 100n).toString() })}
                error={form.fieldErrors.price}
                under={
                  live && (
                    <p className="flex items-baseline justify-between gap-4 text-body text-ink" aria-live="polite">
                      <span>{t.form.youGet}</span>
                      <Money tiyn={live.youGetTiyn} />
                    </p>
                  )
                }
              />
              <TextField label={t.form.days} name="days" inputMode="numeric" autoComplete="off" value={values.days} onChange={(e) => draft.set({ days: e.target.value })} error={form.fieldErrors.days} />
              <TextField
                label={t.form.warranty}
                name="warranty"
                inputMode="numeric"
                autoComplete="off"
                value={values.warranty}
                onChange={(e) => draft.set({ warranty: e.target.value })}
                error={form.fieldErrors.warranty}
              />
              <TextArea label={t.form.comment} name="comment" value={values.comment} onChange={(e) => draft.set({ comment: e.target.value })} maxLength={COMMENT_MAX} error={form.fieldErrors.comment} />
              {general && (
                <Notice tone="danger" live>
                  {form.error}
                </Notice>
              )}
            </Stack>
          </form>
        </Card>
      </Section>
      {money ? (
        <MasterMoney money={money} device={device} />
      ) : (
        <Card>
          <p className="text-body text-muted">{t.form.moneyEmpty}</p>
        </Card>
      )}
      <ActionDock>
        <Button type="submit" form={FORM_ID} pending={form.pending}>
          {t.form.submit}
        </Button>
      </ActionDock>
    </>
  );
}
