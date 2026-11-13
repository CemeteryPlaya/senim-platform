"use client";

import { ru } from "@/i18n/ru";
import { Explain, RadioCard, RadioGroup, Stack } from "@/kit";
import type { Segment } from "@/generated/prisma/enums";
import { SEGMENTS } from "@/modules/requests/client";
import type { Device } from "@/platform/device";
import { SEGMENT_NAMES, segmentMaterials } from "@/verticals/furniture";
import { WizardFrame, useWizardStep, type WizardBase } from "./WizardFrame";
import { useStepMemory } from "./wizard-memory";

const t = ru.app.requests.wizard.segment;

type Props = {
  base: WizardBase;
  device: Device;
  /** Выбранный уровень: сохранённый, подсказанный по материалам или уровень мастера прямой заявки. */
  initial: Segment | null;
  options: { value: Segment; label: string; description: string }[];
  /** Откуда вилки цен (по скольким предложениям) или `null`. */
  priceNote: string | null;
};

/** «Чем отличаются уровни»: материалы каждого уровня из справочников вертикали — по нажатию. */
function Differences({ device }: { device: Device }) {
  const d = t.differences;
  return (
    <div>
      <Explain label={d.label} title={d.title} device={device}>
        <Stack>
          {SEGMENTS.map((segment) => {
            const m = segmentMaterials(segment);
            const parts = [
              [d.facades, m.facades],
              [d.countertops, m.countertops],
              [d.hardware, m.hardware],
            ] as const;
            return (
              <p key={segment} className="text-body text-ink">
                <span className="font-semibold">{SEGMENT_NAMES[segment]}.</span>{" "}
                {parts
                  .filter(([, names]) => names.length > 0)
                  .map(([label, names]) => `${label}: ${names.join(", ")}`)
                  .join(". ")}
              </p>
            );
          })}
        </Stack>
      </Explain>
    </div>
  );
}

/** Шаг 2 «Какой уровень мебели?»: три карточки (что значит уровень и обычная цена по предложениям мастеров). */
export function WizardSegment({ base, device, initial, options, priceNote }: Props) {
  const form = useWizardStep("segment", base);
  const [state, setState] = useStepMemory(base.draftId, "segment", { segment: initial ?? "" });
  const lead = base.direct !== null ? t.leadDirect(base.direct) : t.lead;
  return (
    <WizardFrame base={base} title={t.title} lead={lead} form={form}>
      <Stack>
        <RadioGroup legend={t.legend} legendHidden error={form.errors.segment}>
          {options.map((o) => (
            <RadioCard
              key={o.value}
              label={o.label}
              description={o.description}
              name="segment"
              value={o.value}
              checked={o.value === state.segment}
              onChange={() => setState({ segment: o.value })}
            />
          ))}
        </RadioGroup>
        {priceNote && <p className="text-sub text-muted">{priceNote}</p>}
        <Differences device={device} />
      </Stack>
    </WizardFrame>
  );
}
