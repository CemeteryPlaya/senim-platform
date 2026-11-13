"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, ConfirmDialog, Dialog, HiddenField, Notice, Sheet, Stack, TextField, toast } from "@/kit";
import type { ActionResult } from "@/platform/action";
import type { Device } from "@/platform/device";
import { outcomeOf, useActionForm } from "../../../../../../_shell/form";
import { to } from "../../../../../../_shell/paths";
import { acceptPriceAction, proposePriceAction, withdrawPriceAction } from "../actions";

const t = ru.app.offer;

/**
 * Ответ действия, вызванного не формой (подтверждение в окне): успех — `onSuccess`; «сессия истекла» / «нужно согласие» —
 * уход на экран v2 с возвратом (outcomeOf); отказ — тост с текстом сервера и обновление экрана (цена могла измениться).
 * Окно закрывается в любом случае: после отказа его содержимое устарело.
 */
function useSettle() {
  const router = useRouter();
  return <T,>(result: ActionResult<T>, onSuccess: (data: T) => void): true => {
    const outcome = outcomeOf(result, window.location);
    if (outcome.kind === "success") onSuccess(outcome.data);
    else if (outcome.kind === "leave") window.location.assign(outcome.href);
    else {
      toast.error(outcome.error);
      router.refresh();
    }
    return true;
  };
}

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
  return (
    <form onSubmit={form.onSubmit} noValidate>
      <Stack>
        <HiddenField name="offerId" value={offerId} />
        <TextField
          label={t.propose.amount}
          name="amount"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="send"
          error={form.fieldErrors.amount}
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
 * «Предложить свою цену»: поле суммы в тенге в шторке (телефон) или диалоге (компьютер). Пока окно закрыто, на экране
 * только кнопка-открыватель (`primary` — когда это единственное действие торга, иначе тихая). Ошибки — у поля; после
 * отправки окно закрывается и экран обновляется (торг — «ждём ответа мастера»); закрытие окна тоже обновляет экран.
 */
export function ProposeButton({ device, offerId, primary }: { device: Device; offerId: string; primary: boolean }) {
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
      description={t.propose.description}
      trigger={<Button variant={primary ? "primary" : "quiet"}>{t.actions.propose}</Button>}
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

/** «Отозвать предложение»: своё открытое, с подтверждением; после — экран обновляется (цены, ждущей ответа, нет). */
export function WithdrawButton({ device, proposalId }: { device: Device; proposalId: string }) {
  const router = useRouter();
  const settle = useSettle();
  return (
    <ConfirmDialog
      device={device}
      trigger={
        <Button variant="quiet" flush>
          {t.actions.withdraw}
        </Button>
      }
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
