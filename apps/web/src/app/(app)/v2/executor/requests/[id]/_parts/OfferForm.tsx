"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, HiddenField, MoneyField, Money, Notice, Section, Stack, TextArea, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { useActionForm } from "../../../../../_shell/form";
import { LeaveGuard } from "../../../../../_shell/LeaveGuard";
import { sendOfferAction } from "../actions";
import { formMoney, liveMoney } from "./live-money";
import { MasterMoney } from "./MasterMoney";
import { COMMENT_MAX } from "./schema";

const t = ru.app.masterOffer;

/** Форма одна на экране: кнопка в доке связана с ней атрибутом `form`. */
const FORM_ID = "master-offer-form";

/** Гарантия по умолчанию — как в форме v1 (12 месяцев); мастер меняет её сам. */
const DEFAULT_WARRANTY = "12";

/**
 * Форма предложения: цена, срок, гарантия, комментарий; под ними — живой расчёт «Цена покупателю → Гарантия оплаты и
 * клиента (4%) → Вы получите» по введённой цене (`formMoney`: та же формула, что у модуля, итог на сервере —
 * `partyEstimate("EXECUTOR")`). Главное действие «Отправить предложение» — в `ActionDock` последним (связь с формой —
 * атрибутом `form`): на телефоне док прилипает над панелью вкладок, поэтому форма ставится последней в колонке экрана.
 * Ошибки — у полей, введённое сохраняется; двойное нажатие — один вызов (useActionForm). После отправки — тост и экран
 * в состоянии «ждём ответа покупателя».
 */
export function OfferForm({ requestId, device }: { requestId: string; device: Device }) {
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [dirty, setDirty] = useState(false);
  const form = useActionForm(sendOfferAction, {
    onSuccess: () => {
      setDirty(false);
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
          <form id={FORM_ID} onSubmit={form.onSubmit} onInput={() => setDirty(true)} noValidate>
            <Stack>
              <HiddenField name="requestId" value={requestId} />
              <MoneyField
                label={t.form.price}
                name="price"
                enterKeyHint="next"
                onValueChange={(tiyn) => setPrice(tiyn === null ? "" : (tiyn / 100n).toString())}
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
              <TextField label={t.form.days} name="days" inputMode="numeric" autoComplete="off" error={form.fieldErrors.days} />
              <TextField
                label={t.form.warranty}
                name="warranty"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={DEFAULT_WARRANTY}
                error={form.fieldErrors.warranty}
              />
              <TextArea label={t.form.comment} name="comment" maxLength={COMMENT_MAX} error={form.fieldErrors.comment} />
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
      <LeaveGuard dirty={dirty} device={device} />
      <ActionDock>
        <Button type="submit" form={FORM_ID} pending={form.pending}>
          {t.form.submit}
        </Button>
      </ActionDock>
    </>
  );
}
