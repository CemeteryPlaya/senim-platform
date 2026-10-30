"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import { completeMeasurementSchema, scheduleMeasurementSchema, sendOfferSchema } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Button, Input, Select, Textarea } from "@/ui";
import { FormError, useRunAction, type ServerAction } from "@/app/requests/_parts/ActionButton";
import { completeMeasurementAction, scheduleMeasurementAction, sendOfferAction } from "./actions";

const t = ru.requests.executorRequest;

type Errors = Record<string, string[] | undefined>;
const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/\s/g, "").replace(",", ".")));

/** Проверка той же схемой, что и на сервере, затем вызов действия; ошибки полей — под полями. */
function useSchemaForm<S extends z.ZodType, T>(schema: S, action: ServerAction<z.output<S>, T>) {
  const [errors, setErrors] = useState<Errors>({});
  const { run, pending, error } = useRunAction(action);
  const submit = (raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as Errors);
      return;
    }
    setErrors({});
    void run(parsed.data);
  };
  return { submit, pending, error, errors };
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form noValidate onSubmit={handle} className="flex flex-col gap-5">
      {children}
    </form>
  );
}

type Terms = "FREE" | "INCLUDED" | "FEE_IF_NO_DEAL";

/** Форма отклика. Условия замера по умолчанию — из профиля исполнителя. */
export function OfferForm({ requestId, defaults }: { requestId: string; defaults: { measurementTerms: Terms; measurementFee: number | null } }) {
  const { submit, pending, error, errors } = useSchemaForm(sendOfferSchema, sendOfferAction);
  const [f, setF] = useState({
    price: "",
    durationDays: "",
    warrantyMonths: "12",
    measurementTerms: defaults.measurementTerms as string,
    measurementFee: defaults.measurementFee?.toString() ?? "",
    comment: "",
  });
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const fee = f.measurementTerms === "FEE_IF_NO_DEAL";
  const e1 = (k: string) => errors[k]?.[0];
  return (
    <Form
      onSubmit={() =>
        submit({
          requestId,
          price: num(f.price),
          durationDays: num(f.durationDays),
          warrantyMonths: num(f.warrantyMonths),
          comment: f.comment,
          measurementTerms: f.measurementTerms,
          measurementFee: fee ? (num(f.measurementFee) ?? null) : null,
        })
      }
    >
      <Input label={t.price} hint={t.priceHint} inputMode="numeric" value={f.price} onChange={(e) => set({ price: e.target.value })} error={e1("price")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Input label={t.duration} inputMode="numeric" value={f.durationDays} onChange={(e) => set({ durationDays: e.target.value })} error={e1("durationDays")} />
        <Input label={t.warranty} inputMode="numeric" value={f.warrantyMonths} onChange={(e) => set({ warrantyMonths: e.target.value })} error={e1("warrantyMonths")} />
      </div>
      <Select
        label={t.terms}
        hint={t.termsHint}
        placeholder={false}
        value={f.measurementTerms}
        onChange={(e) => set({ measurementTerms: e.target.value })}
        options={(["FREE", "INCLUDED", "FEE_IF_NO_DEAL"] as const).map((v) => ({ value: v, label: ru.requests.termsOption[v] }))}
        error={e1("measurementTerms")}
      />
      {fee && <Input label={t.fee} inputMode="numeric" value={f.measurementFee} onChange={(e) => set({ measurementFee: e.target.value })} error={e1("measurementFee")} />}
      <Textarea label={t.comment} hint={t.commentHint} optional value={f.comment} maxLength={1000} onChange={(e) => set({ comment: e.target.value })} error={e1("comment")} />
      <Button type="submit" loading={pending}>
        {t.send}
      </Button>
      <FormError message={error} />
    </Form>
  );
}

/** Назначение замера: время в часовом поясе устройства, на сервер — ISO-строка. */
export function ScheduleForm({ offerId }: { offerId: string }) {
  const { submit, pending, error, errors } = useSchemaForm(scheduleMeasurementSchema, scheduleMeasurementAction);
  const [when, setWhen] = useState("");
  return (
    <Form onSubmit={() => submit({ offerId, scheduledAt: when ? new Date(when).toISOString() : undefined })}>
      <Input label={t.scheduleLabel} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} error={errors.scheduledAt?.[0]} />
      <Button type="submit" loading={pending}>
        {t.schedule}
      </Button>
      <FormError message={error} />
    </Form>
  );
}

/** Итог замера: итоговая цена и комментарий заказчику. */
export function CompleteForm({ measurementId }: { measurementId: string }) {
  const { submit, pending, error, errors } = useSchemaForm(completeMeasurementSchema, completeMeasurementAction);
  const [f, setF] = useState({ finalPrice: "", result: "" });
  return (
    <Form onSubmit={() => submit({ measurementId, finalPrice: num(f.finalPrice), result: f.result })}>
      <Input label={t.finalPrice} inputMode="numeric" value={f.finalPrice} onChange={(e) => setF({ ...f, finalPrice: e.target.value })} error={errors.finalPrice?.[0]} />
      <Textarea label={t.result} hint={t.resultHint} optional value={f.result} maxLength={1000} onChange={(e) => setF({ ...f, result: e.target.value })} error={errors.result?.[0]} />
      <Button type="submit" loading={pending}>
        {t.complete}
      </Button>
      <FormError message={error} />
    </Form>
  );
}
