"use client";

import clsx from "clsx";
import { Check, CheckCircle2, CreditCard, Landmark, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { fundEscrowAction } from "@/app/actions";
import { Modal, Spinner } from "@/components/modal";
import { Button, inputClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { tenge } from "@/lib/format";

const STEPS = ["Авторизация платежа в банке", "Зачисление на эскроу-счёт", "Блокировка средств до исполнения договора"];

export function BankModal({
  onClose,
  dealId,
  amount,
  iban,
  contractNo,
}: {
  onClose: () => void;
  dealId: string;
  amount: number;
  iban: string;
  contractNo: string;
}) {
  const [tab, setTab] = useState<"card" | "transfer">("card");
  const [phase, setPhase] = useState<"form" | "processing" | "done">("form");
  const [progress, setProgress] = useState(0);
  const { run, error } = useAction();

  useEffect(() => {
    if (phase !== "processing") return;
    if (progress < STEPS.length) {
      const t = setTimeout(() => setProgress((p) => p + 1), 750);
      return () => clearTimeout(t);
    }
    run(() => fundEscrowAction(dealId), () => setPhase("done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, progress]);

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center gap-2 rounded-t-3xl bg-ink px-6 py-4 text-white">
        <Landmark size={18} />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Банк-партнёр</div>
          <div className="text-[11px] text-white/60">Безопасный платёж · эскроу</div>
        </div>
      </div>

      <div className="p-6">
        <dl className="tabular grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Получатель</dt>
          <dd className="font-medium">Эскроу-счёт по договору № {contractNo}</dd>
          <dt className="text-muted">Счёт</dt>
          <dd className="font-medium">{iban}</dd>
          <dt className="text-muted">Сумма</dt>
          <dd className="text-xl font-extrabold">{tenge(amount)}</dd>
        </dl>

        {phase === "form" && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-ink/5 p-1 text-sm">
              {(
                [
                  ["card", "Картой"],
                  ["transfer", "По реквизитам"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={clsx("rounded-lg py-2 font-medium", tab === k ? "bg-surface shadow-sm" : "text-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "card" ? (
              <div className="mt-4 space-y-3">
                <div className="relative">
                  <CreditCard size={16} className="absolute top-3 left-3 text-muted" />
                  <input defaultValue="4242 4242 4242 4242" aria-label="Номер карты (тестовый)" className={`${inputClass} tabular pl-9`} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input defaultValue="12/30" aria-label="Срок действия" className={`${inputClass} tabular`} />
                  <input placeholder="CVV" autoComplete="off" type="password" className={inputClass} />
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-muted">
                Перевод из любого банка РК по реквизитам эскроу-счёта. Зачисление — до 1 рабочего дня, статус обновится
                автоматически.
              </p>
            )}
            <Button className="mt-5 w-full py-3 text-base" onClick={() => setPhase("processing")}>
              <Lock size={16} /> Оплатить {tenge(amount)}
            </Button>
            <p className="mt-3 text-center text-xs text-muted">
              Деньги не уходят мастеру: они заморожены в банке и раскрываются только после подтверждения этапов.
            </p>
          </>
        )}

        {phase === "processing" && (
          <ul className="mt-6 space-y-3">
            {STEPS.map((s, i) => (
              <li key={s} className={clsx("flex items-center gap-3 text-sm", i > progress && "text-muted")}>
                {i < progress ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check size={12} />
                  </span>
                ) : i === progress ? (
                  <Spinner className="h-5 w-5 text-brand" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-line" />
                )}
                {s}
              </li>
            ))}
            {error && <li className="rounded-xl bg-red-soft p-3 text-sm text-red">{error}</li>}
          </ul>
        )}

        {phase === "done" && (
          <div className="mt-6 flex flex-col items-center text-center">
            <CheckCircle2 size={56} className="text-brand" />
            <div className="mt-3 text-lg font-bold">Средства заморожены на эскроу</div>
            <p className="mt-1 text-sm text-muted">Мастер получил уведомление и может приступать к работе.</p>
            <Button className="mt-5 w-full" onClick={onClose}>
              Вернуться к сделке
            </Button>
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-muted">Демо: платёж имитируется. В продакшене — API банка-партнёра и webhook.</p>
      </div>
    </Modal>
  );
}
