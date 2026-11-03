"use client";

import { useRef, useState } from "react";
import { proposePriceSchema } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Button, ConfirmButton, FormError, Input, useFocusInvalid } from "@/ui";
import { useRunAction } from "@/app/requests/_parts/ActionButton";
import { acceptPriceAction, proposePriceAction, withdrawPriceAction } from "./actions";

const t = ru.requests.negotiation;

export type NegotiationActionsProps = {
  offerId: string;
  /** Открытая цена другой стороны: её можно принять. Подпись суммы уже отформатирована на сервере. */
  accept: { proposalId: string; amount: string } | null;
  /** Своя открытая цена: её можно отозвать. */
  withdrawId: string | null;
  canPropose: boolean;
  /** Покупателю при акцепте — ещё и «другие отклики будут закрыты». */
  party: "CLIENT" | "EXECUTOR";
};

/** Сумма из поля: пробелы и неразрывные пробелы между разрядами убираются; не число — NaN (покажет схема). */
const toKzt = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw.replace(/[\s ]/g, "")));

/**
 * Кнопки торга: «Принять N ₸» (главное действие, с подтверждением; после — переход к оферте), «Предложить цену»
 * (поле суммы в тенге раскрывается по нажатию) и «Отозвать мою цену». Права и состояние проверяет сервер.
 */
export function NegotiationActions({ offerId, accept, withdrawId, canPropose, party }: NegotiationActionsProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string>();
  const { ref: formRef, focusInvalid } = useFocusInvalid();
  const proposeButton = useRef<HTMLButtonElement>(null);
  const accepting = useRunAction(acceptPriceAction, (d) => `/deals/${d.dealId}`);
  const withdrawing = useRunAction(withdrawPriceAction);
  const proposing = useRunAction(proposePriceAction, () => {
    setOpen(false);
    setAmount("");
  });

  const send = async () => {
    const parsed = proposePriceSchema.safeParse({ offerId, amountKzt: toKzt(amount) });
    if (!parsed.success) {
      setAmountError(ru.requests.validation.price);
      return focusInvalid();
    }
    setAmountError(undefined);
    const result = await proposing.run(parsed.data);
    if (!result.ok && result.fieldErrors) focusInvalid();
  };

  // Форма закрылась — кнопка «Предложить цену» появляется снова: фокус на неё, а не в начало страницы.
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => proposeButton.current?.focus());
  };

  return (
    <div className="flex flex-col gap-4">
      {accept && (
        <ConfirmButton
          onRun={() => void accepting.run({ proposalId: accept.proposalId })}
          pending={accepting.pending}
          error={accepting.error}
          fullWidth
          confirm={{
            title: t.acceptConfirmTitle(accept.amount),
            text: party === "CLIENT" ? t.acceptConfirmTextClient : t.acceptConfirmText,
            yes: t.acceptConfirm,
            no: ru.common.actions.notNow,
            tone: "primary",
          }}
        >
          {t.accept(accept.amount)}
        </ConfirmButton>
      )}

      {canPropose && !open && (
        <Button ref={proposeButton} variant={accept ? "secondary" : "primary"} onClick={() => setOpen(true)} className="sm:self-start">
          {accept ? t.counter : t.propose}
        </Button>
      )}
      {canPropose && open && (
        <form
          ref={formRef}
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            label={t.amountLabel}
            hint={t.amountHint}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amountError ?? proposing.fieldErrors?.amountKzt?.[0]}
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button variant="ghost" disabled={proposing.pending} onClick={close}>
              {t.cancelInput}
            </Button>
            <Button type="submit" loading={proposing.pending}>
              {t.send}
            </Button>
          </div>
          <FormError message={proposing.error} />
        </form>
      )}

      {withdrawId && (
        <div className="self-start">
          <ConfirmButton
            onRun={() => void withdrawing.run({ proposalId: withdrawId })}
            pending={withdrawing.pending}
            error={withdrawing.error}
            variant="ghost"
            confirm={{ title: t.withdrawConfirmTitle, text: t.withdrawConfirmText, yes: t.withdrawConfirm, no: ru.common.actions.notNow, tone: "danger" }}
          >
            {t.withdraw}
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
