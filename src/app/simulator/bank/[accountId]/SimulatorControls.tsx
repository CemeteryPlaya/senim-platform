"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Input } from "@/ui";
import { useRunAction } from "../../../deals/_parts/useRunAction";
import { depositAction, redeliverAction } from "./actions";

const t = ru.payments.simulator;

/** Заказчик «пополняет» счёт: по умолчанию — вся сумма договора, можно частями. */
export function DepositForm({ accountId, defaultAmount }: { accountId: string; defaultAmount: number }) {
  const { run, pending, error, fieldErrors } = useRunAction(depositAction);
  const [amount, setAmount] = useState(String(defaultAmount));
  const [done, setDone] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        run({ accountId, amount: Number(amount.replace(/\s/g, "")) }, () => setDone(true));
      }}
    >
      <Input
        label={t.depositAmount}
        hint={t.depositHint}
        name="amount"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={fieldErrors.amount?.[0]}
      />
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {done && (
        <Alert tone="success" live="polite">
          {t.depositDone}
        </Alert>
      )}
      <Button type="submit" fullWidth loading={pending}>
        {t.deposit}
      </Button>
    </form>
  );
}

/** Повторная доставка последнего вебхука: показать банку, что повтор не меняет сделку. */
export function RedeliverButton({ accountId }: { accountId: string }) {
  const { run, pending, error } = useRunAction(redeliverAction);
  const [duplicate, setDuplicate] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">{t.redeliverHint}</p>
      <Button variant="secondary" fullWidth loading={pending} onClick={() => run({ accountId }, (data) => setDuplicate(data.duplicate))}>
        {t.redeliver}
      </Button>
      {duplicate && (
        <Alert tone="success" live="polite">
          {t.redeliverDone}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
    </div>
  );
}
