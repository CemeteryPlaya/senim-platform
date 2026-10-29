"use client";

import { useState, useTransition } from "react";
import { Info, Lock } from "lucide-react";
import { createDealAction } from "@/app/actions";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { FURNITURE_TYPES } from "@/lib/deal/labels";
import { COMMISSION_RATE, defaultStages, split, trancheFor } from "@/lib/deal/money";
import { tenge } from "@/lib/format";

const ADVANCE_OPTIONS = [0, 30, 40, 50];

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function NewDealForm({ masterId, defaultType, defaultAddress }: { masterId: string; defaultType: string; defaultAddress: string }) {
  const [amount, setAmount] = useState(650_000);
  const [advance, setAdvance] = useState(40);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stages = defaultStages(advance);
  const { commission, net } = split(amount);

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await createDealAction(fd);
          if (res?.error) setError(res.error);
        })
      }
      className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]"
    >
      <input type="hidden" name="masterId" value={masterId} />
      <input type="hidden" name="advancePercent" value={advance} />

      <Card className="space-y-5 p-5 md:p-6">
        <h2 className="font-bold">Что нужно изготовить</h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Название заказа">
            <input name="title" required defaultValue="Кухня в новую квартиру" className={inputClass} />
          </Field>
          <Field label="Тип мебели">
            <select name="furnitureType" defaultValue={defaultType} className={inputClass}>
              {FURNITURE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Описание">
          <textarea
            name="description"
            required
            rows={3}
            defaultValue="Прямая кухня под потолок, верхние шкафы в два ряда, встроенная посудомойка и духовой шкаф, подсветка рабочей зоны."
            className={inputClass}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Габариты">
            <input name="dimensions" defaultValue="3,0 × 2,7 м" className={inputClass} />
          </Field>
          <Field label="Материалы">
            <input name="materials" defaultValue="ЛДСП Egger, МДФ, Blum" className={inputClass} />
          </Field>
          <Field label="Цвет / отделка">
            <input name="color" defaultValue="Белый матовый + дуб" className={inputClass} />
          </Field>
        </div>
        <Field label="Адрес установки">
          <input name="address" required defaultValue={`${defaultAddress}ул. Туран, 55, кв. 21`} className={inputClass} />
        </Field>

        <h2 className="pt-2 font-bold">Деньги и сроки</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Сумма сделки, ₸">
            <input
              name="amount"
              inputMode="numeric"
              required
              value={new Intl.NumberFormat("ru-RU").format(amount)}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)}
              className={`${inputClass} tabular text-base font-semibold`}
            />
          </Field>
          <Field label="Срок готовности">
            <input name="deadline" type="date" required defaultValue={inDays(30)} className={inputClass} />
          </Field>
        </div>
        <Field label="Аванс на материалы" hint="Раскрывается мастеру после того, как вы подтвердите этап «Закупка материалов» с фото и чеками.">
          <div className="flex flex-wrap gap-2">
            {ADVANCE_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAdvance(p)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  advance === p ? "border-brand bg-brand text-white" : "border-line bg-surface hover:border-ink/30"
                }`}
              >
                {p === 0 ? "Без аванса" : `${p}%`}
              </button>
            ))}
          </div>
        </Field>
      </Card>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <div className="bg-brand p-5 text-white">
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <Lock size={13} /> Вы вносите на эскроу-счёт
            </div>
            <div className="tabular mt-1 text-3xl font-extrabold">{tenge(amount)}</div>
          </div>
          <div className="tabular space-y-2 p-5 text-sm">
            {stages.map((s, i) => (
              <div key={s.title} className="flex justify-between gap-3">
                <span className="text-muted">
                  {i + 1}. {s.title}
                </span>
                <span className={s.payoutPercent ? "font-semibold" : "text-muted"}>
                  {s.payoutPercent ? tenge(trancheFor(amount, s.payoutPercent)) : "—"}
                </span>
              </div>
            ))}
            <div className="my-2 border-t border-line" />
            <div className="flex justify-between">
              <span className="text-muted">Комиссия {COMMISSION_RATE * 100}% (платит мастер)</span>
              <span className="whitespace-nowrap">{tenge(commission)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Мастер получит</span>
              <span className="text-brand">{tenge(net)}</span>
            </div>
          </div>
        </Card>
        <p className="flex gap-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          Мастер может принять условия или предложить изменения. После согласования формируется договор для подписи ЭЦП.
        </p>
        {error && <p className="rounded-xl bg-red-soft p-3 text-sm text-red">{error}</p>}
        <Button type="submit" disabled={pending || amount < 10_000} className="w-full py-3 text-base">
          {pending ? "Отправляем…" : "Отправить предложение мастеру"}
        </Button>
      </aside>
    </form>
  );
}
