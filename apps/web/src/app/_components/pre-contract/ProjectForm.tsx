"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { submitProjectSchema, sumLines } from "@/modules/requests/client";
import { Button, FormError, Input, Money, Textarea } from "@/ui";
import { useRunAction } from "@/app/requests/_parts/ActionButton";
import { submitProjectAction } from "./actions";

const t = ru.requests.pre.project;

type Line = { title: string; amount: string };
export type ProjectDraft = { materials: string; costLines: { title: string; amount: number }[]; durationDays: number; warrantyMonths: number };

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.replace(/\s/g, "").replace(",", ".")));
const amountOf = (v: string) => (Number.isFinite(num(v)) ? num(v) : 0);

/**
 * Проект исполнителя: материалы, строки расшифровки (название, сумма), срок, гарантия; итоговая цена — сумма строк.
 * Новая версия после «Внести изменения» начинается с прошлой. Проверка — той же схемой, что на сервере.
 */
export function ProjectForm({ offerId, initial, isNewVersion }: { offerId: string; initial: ProjectDraft; isNewVersion: boolean }) {
  const [materials, setMaterials] = useState(initial.materials);
  const [lines, setLines] = useState<Line[]>(initial.costLines.map((l) => ({ title: l.title, amount: String(l.amount) })));
  const [durationDays, setDuration] = useState(String(initial.durationDays));
  const [warrantyMonths, setWarranty] = useState(String(initial.warrantyMonths));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending, error } = useRunAction(submitProjectAction);
  const total = lines.reduce((s, l) => s + amountOf(l.amount), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const costLines = lines.map((l) => ({ title: l.title, amount: num(l.amount) }));
    const parsed = submitProjectSchema.safeParse({
      offerId,
      materials,
      costLines,
      durationDays: num(durationDays),
      warrantyMonths: num(warrantyMonths),
      totalPrice: sumLines(costLines.map((l) => ({ amount: Number.isFinite(l.amount) ? l.amount : 0 }))),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    void run(parsed.data);
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <Textarea label={t.materials} hint={t.materialsHint} value={materials} maxLength={2000} onChange={(e) => setMaterials(e.target.value)} error={errors.materials} />
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-lg font-bold text-ink">{t.costLines}</legend>
        {errors.costLines && <p className="text-base font-semibold text-danger">{errors.costLines}</p>}
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-control border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <Input label={t.lineTitle(i + 1)} value={line.title} onChange={(e) => setLine(i, { title: e.target.value })} error={errors[`costLines.${i}.title`]} />
            <Input label={t.lineAmount(i + 1)} inputMode="numeric" value={line.amount} onChange={(e) => setLine(i, { amount: e.target.value })} error={errors[`costLines.${i}.amount`]} />
            {lines.length > 1 && (
              <Button type="button" variant="ghost" icon={<Trash2 />} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                {t.removeLine(i + 1)}
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" icon={<Plus />} className="self-start" onClick={() => setLines([...lines, { title: "", amount: "" }])}>
          {t.addLine}
        </Button>
      </fieldset>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
        <Input label={t.duration} inputMode="numeric" value={durationDays} onChange={(e) => setDuration(e.target.value)} error={errors.durationDays} />
        <Input label={t.warranty} inputMode="numeric" value={warrantyMonths} onChange={(e) => setWarranty(e.target.value)} error={errors.warrantyMonths} />
      </div>
      <p className="flex flex-col" aria-live="polite">
        <span className="text-base text-muted">
          {t.total} <span className="text-sm">({t.totalHint})</span>
        </span>
        <Money amount={total} className="text-2xl font-extrabold text-ink" />
        {errors.totalPrice && <span className="text-base font-semibold text-danger">{errors.totalPrice}</span>}
      </p>
      <Button type="submit" loading={pending}>
        {isNewVersion ? t.sendNew : t.send}
      </Button>
      <FormError message={error} />
    </form>
  );
}
