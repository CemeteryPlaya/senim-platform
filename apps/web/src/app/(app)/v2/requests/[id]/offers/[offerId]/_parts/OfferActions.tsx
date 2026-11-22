"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, ConfirmDialog, Dialog, HiddenField, Money, MoneyField, Notice, Sheet, Stack, toast } from "@/kit";
import { computeDealMoney, MAX_PRICE_TIYN } from "@/modules/payments/client";
import type { Device } from "@/platform/device";
import { useActionForm } from "../../../../../../_shell/form";
import { LinkButton } from "../../../../../../_shell/LinkButton";
import { useSettle } from "../../../../../../_shell/settle";
import { to } from "../../../../../../_shell/paths";
import { acceptPriceAction, proposePriceAction, withdrawPriceAction } from "../actions";

const t = ru.app.offer;

export type AcceptButtonProps = {
  device: Device;
  offerId: string;
  /** Предложение цены, которое человек видит на экране: принимается ровно оно. */
  proposalId: string;
  label: string;
  confirmTitle: string;
  confirmDescription: string;
};

/**
 * «Принять X» — главное действие экрана: подтверждение (шторка на телефоне, диалог на компьютере) с ценой, защитой
 * сделки и суммой к оплате; после — сделка. Двойное нажатие гасит окно (кнопка в ожидании), повтор запроса — действие
 * (та же сделка). Мастер успел изменить цену — тост и обновлённый экран, сделки нет.
 */
export function AcceptButton({ device, offerId, proposalId, label, confirmTitle, confirmDescription }: AcceptButtonProps) {
  const router = useRouter();
  const settle = useSettle();
  return (
    <ConfirmDialog
      device={device}
      trigger={<Button>{label}</Button>}
      title={confirmTitle}
      description={confirmDescription}
      confirmLabel={t.acceptConfirm.confirm}
      onConfirm={async () =>
        settle(await acceptPriceAction({ offerId, proposalId }), ({ dealId }) => router.push(to(`/deals/${encodeURIComponent(dealId)}`)))
      }
    />
  );
}

/** Форма своей цены внутри окна: монтируется при каждом открытии — прошлые ошибки не остаются. */
function ProposeForm({ device, offerId, onDone }: { device: Device; offerId: string; onDone: () => void }) {
  const form = useActionForm(proposePriceAction, { onSuccess: onDone });
  const [tiyn, setTiyn] = useState<bigint | null>(null);
  // Сколько заплатит покупатель по введённой цене: цена без доплат (ADR-015) — тот же расчёт, что у сделки.
  const total = tiyn !== null && tiyn > 0n && tiyn <= MAX_PRICE_TIYN ? computeDealMoney(tiyn).buyerTotalTiyn : null;
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack>
        <HiddenField name="offerId" value={offerId} />
        <MoneyField
          label={t.propose.amount}
          name="amount"
          enterKeyHint="send"
          onValueChange={setTiyn}
          error={form.fieldErrors.amount}
          under={
            total !== null && (
              <p className="flex items-baseline justify-between gap-4 text-body text-ink" aria-live="polite">
                <span>{t.propose.toPay}</span>
                <Money tiyn={total} />
              </p>
            )
          }
        />
        {form.error && !form.fieldErrors.amount && (
          <Notice tone="danger" live>
            {form.error}
          </Notice>
        )}
        <Button type="submit" full={device === "mobile"} pending={form.pending}>
          {t.propose.submit}
        </Button>
      </Stack>
    </form>
  );
}

/**
 * «Предложить свою цену»: поле суммы в тенге в шторке (телефон) или диалоге (компьютер); в описании окна — цена мастера.
 * Пока окно закрыто, на экране только открыватель: главная кнопка (`primary` — когда это единственное действие торга)
 * или тихая кнопка-ссылка под «Сейчас». Ошибки — у поля; после отправки окно закрывается и экран обновляется (торг —
 * «ждём ответа мастера»); закрытие окна тоже обновляет экран.
 */
export function ProposeButton({ device, offerId, primary, description }: { device: Device; offerId: string; primary: boolean; description: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) router.refresh();
  };
  const Window = device === "mobile" ? Sheet : Dialog;
  return (
    <Window
      title={t.propose.title}
      description={description}
      trigger={primary ? <Button>{t.actions.propose}</Button> : <LinkButton label={t.actions.propose} />}
      open={open}
      onOpenChange={change}
    >
      <ProposeForm
        device={device}
        offerId={offerId}
        onDone={() => {
          toast(t.toasts.proposed);
          change(false);
        }}
      />
    </Window>
  );
}

/** «Отозвать мою цену»: своё открытое, с подтверждением; после — экран обновляется (цены, ждущей ответа, нет). */
export function WithdrawButton({ device, proposalId }: { device: Device; proposalId: string }) {
  const router = useRouter();
  const settle = useSettle();
  return (
    <ConfirmDialog
      device={device}
      trigger={<LinkButton label={t.actions.withdraw} />}
      title={t.withdrawConfirm.title}
      description={t.withdrawConfirm.description}
      confirmLabel={t.withdrawConfirm.confirm}
      onConfirm={async () =>
        settle(await withdrawPriceAction({ proposalId }), () => {
          toast(t.toasts.withdrawn);
          router.refresh();
        })
      }
    />
  );
}
