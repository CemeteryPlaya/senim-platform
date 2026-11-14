"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, ConfirmDialog, Dialog, HiddenField, Menu, Money, Notice, Sheet, Stack, TextField, toast } from "@/kit";
import type { Device } from "@/platform/device";
import { useActionForm } from "../../../../../_shell/form";
import { LinkButton } from "../../../../../_shell/LinkButton";
import { useSettle } from "../../../../../_shell/settle";
import { to } from "../../../../../_shell/paths";
import { acceptPriceAction, proposePriceAction, withdrawOfferAction, withdrawPriceAction } from "../actions";
import { liveMoney } from "./live-money";

const t = ru.app.masterOffer;

export type AcceptButtonProps = {
  device: Device;
  offerId: string;
  /** Предложение цены покупателя, которое мастер видит на экране: принимается ровно оно. */
  proposalId: string;
  label: string;
  confirmTitle: string;
  confirmDescription: string;
};

/**
 * «Принять X» — главное действие экрана: подтверждение (шторка на телефоне, диалог на компьютере) с ценой и суммой
 * «Вы получите»; после — сделка. Двойное нажатие гасит окно (кнопка в ожидании), повтор запроса — действие (та же
 * сделка). Покупатель успел изменить цену — тост и обновлённый экран, сделки нет.
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

/** Форма своей цены внутри окна: монтируется при каждом открытии — прошлые ошибки не остаются. Под полем — «Вы получите». */
function ProposeForm({ device, offerId, onDone }: { device: Device; offerId: string; onDone: () => void }) {
  const form = useActionForm(proposePriceAction, { onSuccess: onDone });
  const [amount, setAmount] = useState("");
  const money = liveMoney(amount);
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={form.fieldErrors.amount}
        />
        {money && (
          <p className="flex items-baseline justify-between gap-4 text-body text-ink" aria-live="polite">
            <span>{t.propose.youGet}</span>
            <Money tiyn={money.youGetTiyn} />
          </p>
        )}
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
 * «Предложить свою цену»: поле суммы в тенге в шторке (телефон) или диалоге (компьютер); в описании окна — цена
 * покупателя. Пока окно закрыто, на экране только открыватель: главная кнопка (`primary` — когда это единственное действие
 * торга) или тихая кнопка-ссылка под «Сейчас». После отправки окно закрывается и экран обновляется («ждём ответа
 * покупателя»); закрытие окна тоже обновляет экран.
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

/** «Отозвать мою цену»: свою открытую, с подтверждением; после — экран обновляется (цены, ждущей ответа, нет). */
export function WithdrawPriceButton({ device, offerId, proposalId }: { device: Device; offerId: string; proposalId: string }) {
  const router = useRouter();
  const settle = useSettle();
  return (
    <ConfirmDialog
      device={device}
      trigger={<LinkButton label={t.actions.withdrawPrice} />}
      title={t.withdrawPriceConfirm.title}
      description={t.withdrawPriceConfirm.description}
      confirmLabel={t.withdrawPriceConfirm.confirm}
      onConfirm={async () =>
        settle(await withdrawPriceAction({ offerId, proposalId }), () => {
          toast(t.toasts.priceWithdrawn);
          router.refresh();
        })
      }
    />
  );
}

/**
 * «Действия с предложением» за кнопкой «три точки»: «Отказаться от заявки» — отозвать предложение целиком (необратимо:
 * новое по этой заявке модуль не примет — подтверждение `danger`).
 * Пункт меню закрывает меню и открывает подтверждение; фокус после окна возвращается на кнопку меню.
 */
export function OfferMenu({ device, offerId }: { device: Device; offerId: string }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const settle = useSettle();
  return (
    <>
      <Menu label={t.actions.menu} device={device} triggerRef={menuButton} items={[{ label: t.actions.withdrawOffer, tone: "danger", onSelect: () => setOpen(true) }]} />
      <ConfirmDialog
        device={device}
        tone="danger"
        open={open}
        returnFocusTo={menuButton}
        onOpenChange={setOpen}
        title={t.withdrawOfferConfirm.title}
        description={t.withdrawOfferConfirm.description}
        confirmLabel={t.withdrawOfferConfirm.confirm}
        cancelLabel={t.withdrawOfferConfirm.keep}
        onConfirm={async () =>
          settle(await withdrawOfferAction({ offerId }), () => {
            toast(t.toasts.offerWithdrawn);
            router.refresh();
          })
        }
      />
    </>
  );
}
