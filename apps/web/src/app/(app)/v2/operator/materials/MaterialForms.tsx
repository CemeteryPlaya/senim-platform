"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { formatDate } from "@/features/format/format";
import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { ActionDock, Button, Card, Checkbox, Columns, HiddenField, Money, MoneyField, Select, StatusChip, Stack, TextField, toast } from "@/kit";
import type { MaterialPriceRow } from "@/modules/operator";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@/verticals/furniture";
import { useActionForm } from "../../../_shell/form";
import { FormError } from "../../../_shell/FormError";
import { addMaterialPriceAction, changeMaterialPriceAction, setMaterialPriceActiveAction } from "./actions";

const t = ru.app.operatorSettings.materials;
const segmentNames = ru.app.operatorSettings.segments;
const SEGMENTS: readonly Segment[] = ["ECONOMY", "COMFORT", "PREMIUM"];
const ADD_FORM = "add-material-form";

/** Строка справочника в клиент: дата — строкой ISO (Date через границу сервер → клиент не передаём). */
export type MaterialRowData = Omit<MaterialPriceRow, "updatedAt"> & { updatedAt: string };

/** Уровни — флажками: материал может относиться к нескольким; ошибка — одна на группу. */
function SegmentChecks({ error }: { error?: string | undefined }) {
  const id = useId();
  return (
    <fieldset aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sub font-medium text-ink">{t.segmentsLegend}</legend>
      <p id={`${id}-hint`} className="text-sub text-muted">
        {t.segmentsHint}
      </p>
      <Columns count={3}>
        {SEGMENTS.map((segment) => (
          <Checkbox key={segment} name={`segment_${segment}`} label={segmentNames[segment]} aria-invalid={error ? true : undefined} />
        ))}
      </Columns>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sub text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Новый материал: категория, единица, название, цена в целых тенге, уровни. Главная кнопка экрана — в доке. */
export function AddMaterialForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useActionForm(addMaterialPriceAction, {
    formRef,
    onSuccess: () => {
      formRef.current?.reset();
      toast(t.added);
      router.refresh();
    },
  });
  return (
    <>
      <Card>
        <form id={ADD_FORM} ref={formRef} onSubmit={form.onSubmit} noValidate>
          <Stack>
            <Columns count={2}>
              <Select label={t.category} name="category" required defaultValue="" error={form.fieldErrors.category}>
                <option value="" disabled>
                  {t.choose}
                </option>
                {MATERIAL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t.categories[category]}
                  </option>
                ))}
              </Select>
              <Select label={t.unit} name="unit" required defaultValue="" error={form.fieldErrors.unit}>
                <option value="" disabled>
                  {t.choose}
                </option>
                {MATERIAL_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t.units[unit]}
                  </option>
                ))}
              </Select>
            </Columns>
            <TextField label={t.name} name="name" required maxLength={80} autoComplete="off" placeholder={t.nameExample} error={form.fieldErrors.name} />
            <MoneyField label={t.price} name="priceKzt" error={form.fieldErrors.priceKzt} />
            <SegmentChecks error={form.fieldErrors.segments} />
            <FormError error={form.error} atField={Object.keys(form.fieldErrors).length > 0} />
          </Stack>
        </form>
      </Card>
      <ActionDock>
        <Button type="submit" form={ADD_FORM} pending={form.pending}>
          {t.add}
        </Button>
      </ActionDock>
    </>
  );
}

/**
 * Строка справочника: название, цена за единицу, уровни, кто и когда обновил; «Изменить цену» (в строке, с прежней ценой
 * `from` — чужое изменение не перезапишется) и «В архив» или «Вернуть». Пока идёт одно действие, другое не начинается.
 */
export function MaterialItem({ row }: { row: MaterialRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const changeFormRef = useRef<HTMLFormElement>(null);
  const unit = t.units[row.unit];

  const change = useActionForm(changeMaterialPriceAction, {
    formRef: changeFormRef,
    onSuccess: () => {
      setEditing(false);
      toast(t.priceSaved);
      router.refresh();
    },
  });
  const toggle = useActionForm(setMaterialPriceActiveAction, {
    toInput: (data) => ({ id: String(data.get("id")), active: data.get("active") === "true" }),
    onSuccess: () => {
      toast(row.active ? t.archived(row.name) : t.restored(row.name));
      router.refresh();
    },
  });
  const busy = change.pending || toggle.pending;

  // Строка изменения открылась — фокус в поле цены.
  useEffect(() => {
    if (editing) changeFormRef.current?.querySelector<HTMLInputElement>('input[name="to"]')?.focus();
  }, [editing]);

  const close = () => {
    setEditing(false);
    editButton.current?.focus();
  };
  const toggleActive = () => {
    if (busy) return;
    const data = new FormData();
    data.set("id", row.id);
    data.set("active", String(!row.active));
    void toggle.submit(data);
  };

  return (
    <div className="flex flex-col gap-3 px-card py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-headline wrap-break-word text-ink">{row.name}</span>
        <span className="text-headline text-ink">
          <Money tiyn={BigInt(row.priceKzt) * 100n} /> <span className="text-sub text-muted">{t.perUnit(unit)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.segments.map((segment) => (
          <StatusChip key={segment} tone="neutral">
            {segmentNames[segment]}
          </StatusChip>
        ))}
        {!row.active && <StatusChip tone="neutral">{t.archivedBadge}</StatusChip>}
      </div>
      <p className="text-sub text-muted">{t.updated(formatDate(new Date(row.updatedAt)), row.updatedBy)}</p>
      <div className="flex flex-wrap gap-2">
        {row.active && (
          <Button
            ref={editButton}
            variant="secondary"
            size="sm"
            aria-expanded={editing}
            aria-label={t.actionFor(t.changePrice, row.name)}
            onClick={() => {
              if (!busy) setEditing((open) => !open);
            }}
          >
            {t.changePrice}
          </Button>
        )}
        <Button variant="quiet" size="sm" pending={toggle.pending} aria-label={t.actionFor(row.active ? t.archive : t.restore, row.name)} onClick={toggleActive}>
          {row.active ? t.archive : t.restore}
        </Button>
      </div>
      {editing && (
        <form
          ref={changeFormRef}
          onSubmit={change.onSubmit}
          noValidate
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <Stack>
            <HiddenField name="id" value={row.id} />
            <HiddenField name="from" value={String(row.priceKzt)} />
            <MoneyField label={t.changePriceLabel(row.name, unit)} name="to" defaultTiyn={BigInt(row.priceKzt) * 100n} error={change.fieldErrors.to} />
            <FormError error={change.error} atField={Boolean(change.fieldErrors.to)} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" size="sm" pending={change.pending}>
                {t.save}
              </Button>
              <Button variant="quiet" size="sm" onClick={close}>
                {t.cancel}
              </Button>
            </div>
          </Stack>
        </form>
      )}
      {toggle.error && !editing && <FormError error={toggle.error} />}
    </div>
  );
}
