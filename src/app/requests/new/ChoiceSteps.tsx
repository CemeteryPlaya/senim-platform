"use client";

import { Gem, PiggyBank, Sofa } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LIMITS, SEGMENTS, type PriceHint } from "@/modules/requests/client";
import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatMoney, Input, RadioCards } from "@/ui";
import { POPULAR_FURNITURE_TYPES, SEGMENT_NAMES, segmentMaterials, STYLES, type StyleKey } from "@/verticals/furniture";
import { FormError } from "../_parts/ActionButton";
import type { StyleExample } from "./examples";
import { OTHER_TYPE_IMAGE, TYPE_IMAGES } from "./images";
import { first, NextButton, SkipButton, StepForm, StepHeading, useStep, type StepBase } from "./StepForm";

const w = ru.requests.wizard;
const OTHER = "__other";
const CUSTOM = "__custom";

// ─── 1. Что нужно? ───────────────────────────────────────────────────────────

type FurnitureType = { id: string; slug: string; name: string };

/** Плитки частых заказов с картинками и «Другое»: под ним — остальные типы справочника и свой вариант. */
export function TypeStep(props: StepBase & { types: readonly FurnitureType[]; initial: { furnitureTypeId: string | null; customType: string | null }; note?: ReactNode }) {
  const { submit, pending, error, errors } = useStep(props);
  const popular = POPULAR_FURNITURE_TYPES.flatMap((slug) => props.types.filter((t) => t.slug === slug));
  const rest = props.types.filter((t) => !popular.includes(t));
  const { furnitureTypeId, customType } = props.initial;
  const isPopular = popular.some((t) => t.id === furnitureTypeId);
  const [main, setMain] = useState(isPopular && furnitureTypeId ? furnitureTypeId : furnitureTypeId || customType ? OTHER : "");
  const [sub, setSub] = useState(!isPopular && furnitureTypeId ? furnitureTypeId : customType ? CUSTOM : "");
  const [custom, setCustom] = useState(customType ?? "");

  const typeId = main === OTHER ? (sub && sub !== CUSTOM ? sub : null) : main || null;
  return (
    <StepForm
      errors={errors}
      onSubmit={() => submit({ screen: "type", furnitureTypeId: typeId, customType: main === OTHER && sub === CUSTOM ? custom : null })}
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={w.type.title} lead={w.type.lead} />
      {props.note}
      <RadioCards
        label={w.type.label}
        name="furnitureType"
        value={main}
        onChange={setMain}
        columns={3}
        error={main === OTHER ? undefined : first(errors, "furnitureTypeId")}
        options={[
          ...popular.map((t) => ({ value: t.id, label: t.name, image: { src: TYPE_IMAGES[t.slug] ?? OTHER_TYPE_IMAGE } })),
          { value: OTHER, label: w.type.other, description: w.type.otherHint, image: { src: OTHER_TYPE_IMAGE } },
        ]}
      />
      {main === OTHER && (
        <RadioCards
          label={w.type.otherLabel}
          name="furnitureTypeOther"
          value={sub}
          onChange={setSub}
          columns={2}
          error={first(errors, "furnitureTypeId")}
          options={[...rest.map((t) => ({ value: t.id, label: t.name })), { value: CUSTOM, label: w.type.customOption, description: w.type.customOptionHint }]}
        />
      )}
      {main === OTHER && sub === CUSTOM && (
        <Input
          label={w.type.customLabel}
          hint={w.type.customHint}
          value={custom}
          maxLength={LIMITS.customType}
          onChange={(e) => setCustom(e.target.value)}
          error={first(errors, "customType")}
        />
      )}
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 2. Какой примерно вид? ──────────────────────────────────────────────────

/**
 * Примеры-картинки вместо названий стилей: подпись — как это выглядит простыми словами, стиль — мелко.
 * Стиль заявки выводится из выбранного примера. Пожелания к стилю из прежнего мастера сохраняются.
 */
export function StyleStep(props: StepBase & { examples: readonly StyleExample[]; initial: { style: string | null; styleNote: string } }) {
  const { submit, pending, error, errors } = useStep(props);
  const [choice, setChoice] = useState(props.initial.style ?? "");
  const style = props.examples.find((e) => e.style === choice)?.style ?? null;
  const save = (value: StyleKey | null) => submit({ screen: "style", style: value, styleNote: props.initial.styleNote });
  return (
    <StepForm
      errors={errors}
      onSubmit={() => save(style)}
      actions={
        <>
          <SkipButton pending={pending} onClick={() => save(null)} />
          <NextButton pending={pending} />
        </>
      }
    >
      <StepHeading title={w.style.title} lead={w.style.lead} />
      <RadioCards
        label={w.style.label}
        name="style"
        value={choice}
        onChange={setChoice}
        columns={3}
        error={first(errors, "style")}
        options={props.examples.map((e) => ({
          value: e.style,
          label: STYLES[e.style].hint,
          description: w.style.styleName(STYLES[e.style].name),
          image: { src: e.src },
        }))}
      />
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 4. Какой уровень? ───────────────────────────────────────────────────────

const SEGMENT_ICONS: Record<Segment, ReactNode> = { ECONOMY: <PiggyBank />, COMFORT: <Sofa />, PREMIUM: <Gem /> };

const m = ru.materials.hint;

/** Строка цены уровня: по материалам (ADR-007), по откликам или «назовут исполнители». */
function priceLine(hint: PriceHint | null): string {
  if (!hint) return w.segment.noPrice;
  const range = w.segment.priceRange(formatMoney(hint.from), formatMoney(hint.to));
  return hint.source === "materials" ? m.price(range) : w.segment.price(range);
}

/** Откуда вилки: по скольким откликам, по материалам, для типового размера, демо-цифры. */
function priceNote(prices: Record<Segment, PriceHint | null>): string | undefined {
  const hints = SEGMENTS.flatMap((k) => (prices[k] ? [prices[k]] : []));
  const offers = hints.reduce((n, h) => n + (h.source === "offers" ? h.count : 0), 0);
  const materials = hints.flatMap((h) => (h.source === "materials" ? [h] : []));
  const typical = materials.find((h) => h.typical)?.typical;
  const notes = [
    materials.length > 0 && m.note,
    typical && m.typicalSize(typical.productUnit === "lm" ? m.sizeLm(typical.widthCm) : m.sizeFront(typical.widthCm, typical.heightCm)),
    materials.some((h) => h.demo) && m.demo,
    // Фраза о точной цене уже есть в пояснении про отклики.
    offers > 0 ? w.segment.priceNote(offers) : materials.length > 0 && m.exact,
  ].filter((x): x is string => typeof x === "string");
  return notes.length > 0 ? notes.join(" ") : undefined;
}

/** Чем отличаются уровни: материалы из справочников вертикали — те же правила, что у подсказки «Почему?». */
function SegmentDifferences() {
  const s = w.segment;
  return (
    <details className="group rounded-card border border-line bg-surface p-4 sm:p-5">
      <summary className="flex min-h-control-sm cursor-pointer items-center text-lg font-bold text-primary">{s.whyTitle}</summary>
      <dl className="mt-3 flex flex-col gap-4">
        {SEGMENTS.map((segment) => {
          const m = segmentMaterials(segment);
          return (
            <div key={segment} className="flex flex-col gap-1">
              <dt className="text-base font-bold text-ink">{SEGMENT_NAMES[segment]}</dt>
              <dd className="text-base text-ink-soft">
                {[
                  [s.facades, m.facades],
                  [s.countertops, m.countertops],
                  [s.hardware, m.hardware],
                ]
                  .filter(([, names]) => names.length > 0)
                  .map(([label, names]) => `${label}: ${(names as string[]).join(", ")}`)
                  .join(". ")}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

export function SegmentStep(
  props: StepBase & { initial: string; prices: Record<Segment, PriceHint | null>; directLabel: string | null; hint?: ReactNode },
) {
  const { submit, pending, error, errors } = useStep(props);
  const [segment, setSegment] = useState(props.initial);
  const s = w.segment;
  return (
    <StepForm errors={errors} onSubmit={() => submit({ screen: "segment", segment: segment || undefined })} actions={<NextButton pending={pending} />}>
      <StepHeading title={s.title} lead={props.directLabel !== null ? s.leadDirect(props.directLabel) : s.lead} />
      {props.hint}
      <RadioCards
        label={s.label}
        name="segment"
        value={segment}
        onChange={setSegment}
        hint={priceNote(props.prices)}
        error={first(errors, "segment")}
        options={SEGMENTS.map((key) => ({
          value: key,
          label: SEGMENT_NAMES[key],
          icon: SEGMENT_ICONS[key],
          description: (
            <>
              <span className="block text-base text-ink-soft">{s.explain[key]}</span>
              <span className="mt-1 block text-base font-semibold text-ink">{priceLine(props.prices[key])}</span>
            </>
          ),
        }))}
      />
      <SegmentDifferences />
      <FormError message={error} />
    </StepForm>
  );
}
