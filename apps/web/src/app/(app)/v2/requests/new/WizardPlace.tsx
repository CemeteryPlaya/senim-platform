"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, CityField, Stack, TextField } from "@/kit";
import { LIMITS, SUGGESTED_CITIES } from "@/modules/requests/client";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";
import { addDays, todayAstana } from "./steps";
import { useStepMemory } from "./wizard-memory";

const t = ru.app.requests.wizard.place;

export type PlaceInitial = { city: string; desiredDate: string };

/**
 * Шаг 4 «Где и когда?»: город и желаемая дата (ADR-016). Адреса, района, ЖК и точки в заявке нет: адрес покупатель
 * укажет в сделке, его увидит только мастер, с которым заключена оферта.
 */
export function WizardPlace({ base, initial }: { base: WizardBase; initial: PlaceInitial }) {
  const form = useWizardStep("place", base);
  // Несохранённый ввод шага переживает «Назад» и перезагрузку (sessionStorage).
  const [place, setPlace] = useStepMemory(base.draftId, "place", initial);
  const set = (patch: Partial<PlaceInitial>) => setPlace((p) => ({ ...p, ...patch }));
  const e = form.errors;
  // Сегодня по Астане: раньше желаемую дату выбрать нельзя; быстрые сроки считаются от этого дня.
  const [today] = useState(() => todayAstana());
  const quick = [
    { label: t.quickDates.month, date: addDays(today, 30) },
    { label: t.quickDates.twoMonths, date: addDays(today, 60) },
    { label: t.quickDates.noRush, date: "" },
  ];
  return (
    <WizardFrame base={base} title={t.title} lead={t.lead} form={form}>
      <CityField label={t.city} name="city" aria-required suggestions={SUGGESTED_CITIES} maxLength={LIMITS.city} value={place.city} onChange={(city) => set({ city })} error={e.city} />
      <Stack>
        <TextField label={t.date} name="desiredDate" type="date" min={today} value={place.desiredDate} onChange={(ev) => set({ desiredDate: ev.target.value })} error={e.desiredDate} />
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Button key={q.label} variant="secondary" size="sm" aria-pressed={place.desiredDate === q.date} onClick={() => set({ desiredDate: q.date })}>
              {q.label}
            </Button>
          ))}
        </div>
      </Stack>
    </WizardFrame>
  );
}
