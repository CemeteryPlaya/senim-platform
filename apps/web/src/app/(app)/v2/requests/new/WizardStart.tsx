"use client";

import { useState } from "react";
import { ru } from "@/i18n/ru";
import { Button, HiddenField, RadioCard, RadioGroup, Select, Stack, TextField } from "@/kit";
import { LIMITS } from "@/modules/requests/client";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";
import {
  COUNTERTOP_OPTIONS,
  CUSTOM,
  FACADE_OPTIONS,
  HARDWARE_OPTIONS,
  OTHER,
  splitTypes,
  STYLE_OPTIONS,
  type AdvancedState,
  type FurnitureType,
} from "./steps";

const t = ru.app.requests.wizard.start;
const facts = ru.requests.facts;
const ADVANCED_ID = "request-advanced";

type Props = {
  base: WizardBase;
  types: readonly FurnitureType[];
  initial: { type: { main: string; sub: string; custom: string }; style: string | null; advanced: AdvancedState };
};

/** Размеры и материалы: у каждого «не знаю»; открыт — значения уходят в шаг (скрытое поле `advanced`). */
function Advanced({ state, onChange, errors }: { state: AdvancedState; onChange: (patch: Partial<AdvancedState>) => void; errors: Record<string, string> }) {
  return (
    <div id={ADVANCED_ID}>
      <Stack gap="section">
        <HiddenField name="advanced" value="1" />
        <RadioGroup legend={t.sizeLegend}>
          <RadioCard label={t.sizeUnknown} name="sizeMode" value="unknown" checked={!state.sizeKnown} onChange={() => onChange({ sizeKnown: false })} />
          <RadioCard label={t.sizeKnown} name="sizeMode" value="known" checked={state.sizeKnown} onChange={() => onChange({ sizeKnown: true })} />
        </RadioGroup>
        {state.sizeKnown && (
          <Stack>
            <TextField label={t.width} name="widthCm" inputMode="numeric" autoComplete="off" value={state.width} onChange={(e) => onChange({ width: e.target.value })} error={errors.widthCm} />
            <TextField label={t.height} name="heightCm" inputMode="numeric" autoComplete="off" value={state.height} onChange={(e) => onChange({ height: e.target.value })} error={errors.heightCm} />
            <TextField label={t.depth} name="depthCm" inputMode="numeric" autoComplete="off" value={state.depth} onChange={(e) => onChange({ depth: e.target.value })} error={errors.depthCm} />
          </Stack>
        )}
        {(
          [
            ["facade", facts.facade, FACADE_OPTIONS],
            ["countertop", facts.countertop, COUNTERTOP_OPTIONS],
            ["hardware", facts.hardware, HARDWARE_OPTIONS],
          ] as const
        ).map(([name, label, options]) => (
          <Select key={name} label={label} name={name} value={state[name]} onChange={(e) => onChange({ [name]: e.target.value })} error={errors[name]}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
      </Stack>
    </div>
  );
}

/**
 * Шаг 1 «Что нужно сделать?»: тип мебели карточками (частые заказы и «Другое» → список справочника или свой вариант),
 * стиль списком («Не важно» по умолчанию). Размеры и материалы — по кнопке, у каждого «не знаю» (блок «Для продвинутых»
 * v1). Картинок-примеров нет: стиль назван словами.
 */
export function WizardStart({ base, types, initial }: Props) {
  const form = useWizardStep("start", base);
  const { popular, rest } = splitTypes(types);
  const [type, setType] = useState(initial.type);
  const [advanced, setAdvanced] = useState(initial.advanced);
  const e = form.errors;
  const typeError = e.furnitureTypeId;

  return (
    <WizardFrame base={base} title={t.title} lead={t.lead} form={form}>
      <RadioGroup legend={t.typeLegend} legendHidden error={type.main === OTHER ? undefined : typeError}>
        {popular.map((item) => (
          <RadioCard
            key={item.id}
            label={item.name}
            name="furnitureType"
            value={item.id}
            checked={type.main === item.id}
            onChange={() => setType({ ...type, main: item.id })}
          />
        ))}
        <RadioCard
          label={t.other}
          description={t.otherDescription}
          name="furnitureType"
          value={OTHER}
          checked={type.main === OTHER}
          onChange={() => setType({ ...type, main: OTHER })}
        />
      </RadioGroup>
      {type.main === OTHER && (
        <Select
          label={t.otherLabel}
          name="furnitureTypeOther"
          value={type.sub}
          onChange={(event) => setType({ ...type, sub: event.target.value })}
          error={type.sub === CUSTOM ? undefined : typeError}
        >
          <option value="">{t.otherPlaceholder}</option>
          {rest.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value={CUSTOM}>{t.custom}</option>
        </Select>
      )}
      {type.main === OTHER && type.sub === CUSTOM && (
        <TextField
          label={t.customLabel}
          name="customType"
          autoComplete="off"
          maxLength={LIMITS.customType}
          value={type.custom}
          onChange={(event) => setType({ ...type, custom: event.target.value })}
          error={e.customType ?? typeError}
        />
      )}
      <Select label={t.styleLabel} name="style" defaultValue={initial.style ?? ""} error={e.style}>
        <option value="">{t.styleAny}</option>
        {STYLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <div>
        <Button variant="quiet" flush aria-expanded={advanced.open} aria-controls={advanced.open ? ADVANCED_ID : undefined} onClick={() => setAdvanced({ ...advanced, open: !advanced.open })}>
          {advanced.open ? t.less : t.more}
        </Button>
      </div>
      {advanced.open && <Advanced state={advanced} onChange={(patch) => setAdvanced({ ...advanced, ...patch })} errors={e} />}
    </WizardFrame>
  );
}
