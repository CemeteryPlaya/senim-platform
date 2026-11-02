"use client";

import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { Segment } from "@/generated/prisma/enums";
import type { MaterialPriceRow } from "@/modules/operator";
import { ru } from "@/i18n/ru";
import { Button, Checkbox, formatDate, formatMoney, Input, Select, StatusBadge } from "@/ui";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@/verticals/furniture";
import { FormStatus } from "../_components/FormStatus";
import { useActionForm } from "../_components/useActionForm";
import { addMaterialPriceAction, changeMaterialPriceAction, setMaterialPriceActiveAction } from "./actions";

const t = ru.materials;
const SEGMENTS: Segment[] = ["ECONOMY", "COMFORT", "PREMIUM"];

/** Уровни — флажками: материал может относиться к нескольким. Ошибка — одна на группу. */
function SegmentChecks({ error }: { error?: string }) {
  const id = useId();
  return (
    <fieldset aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} className="flex flex-col gap-1">
      <legend className="text-base font-semibold text-ink">{t.add.segments}</legend>
      <p id={`${id}-hint`} className="text-sm text-muted">
        {t.add.segmentsHint}
      </p>
      <div className="flex flex-wrap gap-x-6">
        {SEGMENTS.map((s) => (
          <Checkbox key={s} name={`segment_${s}`} label={ru.operator.segments[s]} aria-invalid={error ? true : undefined} />
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-2 text-sm font-semibold text-danger">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
}

export function AddMaterialForm() {
  const form = useActionForm(addMaterialPriceAction, { reset: true });
  return (
    <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Select
          label={t.add.category}
          name="category"
          required
          options={MATERIAL_CATEGORIES.map((c) => ({ value: c, label: t.categories[c] }))}
          error={form.fieldError("category")}
        />
        <Select label={t.add.unit} name="unit" required options={MATERIAL_UNITS.map((u) => ({ value: u, label: t.units[u] }))} error={form.fieldError("unit")} />
      </div>
      <Input label={t.add.name} hint={t.add.nameHint} name="name" required maxLength={80} error={form.fieldError("name")} />
      <Input label={t.add.price} hint={t.add.priceHint} name="priceKzt" required inputMode="numeric" autoComplete="off" error={form.fieldError("priceKzt")} />
      <SegmentChecks error={form.fieldError("segments")} />
      <Button type="submit" loading={form.pending} className="self-start">
        {t.add.submit}
      </Button>
      <FormStatus error={form.error} done={form.done} doneText={t.add.done} />
    </form>
  );
}

/** Строка справочника: цена за единицу, уровни, кто и когда обновил; изменить цену, в архив или вернуть. */
export function MaterialItem({ row }: { row: MaterialPriceRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const change = useActionForm(changeMaterialPriceAction, { onSuccess: () => setEditing(false) });
  const unit = t.units[row.unit];

  const toggleActive = () =>
    startTransition(async () => {
      const result = await setMaterialPriceActiveAction({ id: row.id, active: !row.active });
      setError(result.ok ? undefined : result.error);
      if (result.ok) router.refresh();
    });

  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-lg font-semibold break-words text-ink">{row.name}</span>
        <span className="text-lg font-bold whitespace-nowrap text-ink">{t.perUnit(formatMoney(row.priceKzt), unit)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.segments.map((s) => (
          <StatusBadge key={s}>{ru.operator.segments[s]}</StatusBadge>
        ))}
        {row.isDemo && <StatusBadge tone="warning">{t.demoBadge}</StatusBadge>}
        {!row.active && <StatusBadge tone="neutral">{t.archivedBadge}</StatusBadge>}
      </div>
      <p className="text-sm text-muted">{t.updated(formatDate(row.updatedAt), row.updatedBy)}</p>
      <div className="flex flex-wrap gap-2">
        {row.active && (
          <Button variant="secondary" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {t.changePrice}
          </Button>
        )}
        <Button variant="soft" loading={pending} onClick={toggleActive} aria-label={ru.common.ui.actionFor(row.active ? t.archive : t.restore, row.name)}>
          {row.active ? t.archive : t.restore}
        </Button>
      </div>
      {editing && (
        <form onSubmit={change.onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="from" value={row.priceKzt} />
          <div className="flex-1">
            <Input
              label={t.changePriceLabel(row.name, unit)}
              name="to"
              defaultValue={row.priceKzt}
              required
              inputMode="numeric"
              autoComplete="off"
              error={change.fieldError("to")}
            />
          </div>
          <Button type="submit" loading={change.pending} className="sm:mt-8">
            {t.save}
          </Button>
        </form>
      )}
      <FormStatus error={error ?? change.error} />
    </li>
  );
}
