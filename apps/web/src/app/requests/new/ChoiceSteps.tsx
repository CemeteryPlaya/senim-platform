"use client";

import { ChevronDown, Gem, PiggyBank, Sofa } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LIMITS, SEGMENTS, type PriceHint, type RequestDetails } from "@/modules/requests/client";
import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatMoney, Input, RadioCards, Select } from "@/ui";
import { COUNTERTOPS, FACADES, HARDWARE, POPULAR_FURNITURE_TYPES, SEGMENT_NAMES, segmentMaterials, STYLES } from "@/verticals/furniture";
import { FormError } from "../_parts/ActionButton";
import type { StyleExample } from "./examples";
import { SelfMeasureGuide } from "./DetailSteps";
import { OTHER_TYPE_IMAGE, TYPE_IMAGES } from "./images";
import { first, NextButton, StepForm, StepHeading, useStep, type Errors, type StepBase } from "./StepForm";

const w = ru.requests.wizard;
const OTHER = "__other";
const CUSTOM = "__custom";

// ─── 1. Что и в каком стиле (ТЗ п. 3: на первом шаге — только тип и стиль) ───────────

type FurnitureType = { id: string; slug: string; name: string };

export type StartInitial = {
  furnitureTypeId: string | null;
  customType: string | null;
  style: string | null;
  details: RequestDetails;
};

/** Плитки частых заказов с картинками и «Другое»: под ним — остальные типы справочника и свой вариант. */
function TypeChoice(props: {
  types: readonly FurnitureType[];
  main: string;
  sub: string;
  custom: string;
  onChange: (patch: Partial<{ main: string; sub: string; custom: string }>) => void;
  errors: Errors;
}) {
  const popular = POPULAR_FURNITURE_TYPES.flatMap((slug) => props.types.filter((t) => t.slug === slug));
  const rest = props.types.filter((t) => !popular.includes(t));
  const { main, sub, custom } = props;
  return (
    <>
      <RadioCards
        label={w.type.label}
        name="furnitureType"
        value={main}
        onChange={(v) => props.onChange({ main: v })}
        columns={3}
        error={main === OTHER ? undefined : first(props.errors, "furnitureTypeId")}
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
          onChange={(v) => props.onChange({ sub: v })}
          columns={2}
          error={first(props.errors, "furnitureTypeId")}
          options={[...rest.map((t) => ({ value: t.id, label: t.name })), { value: CUSTOM, label: w.type.customOption, description: w.type.customOptionHint }]}
        />
      )}
      {main === OTHER && sub === CUSTOM && (
        <Input
          label={w.type.customLabel}
          hint={w.type.customHint}
          value={custom}
          maxLength={LIMITS.customType}
          onChange={(e) => props.onChange({ custom: e.target.value })}
          error={first(props.errors, "customType")}
        />
      )}
    </>
  );
}

const UNKNOWN = "unknown";
type AdvancedState = { sizeKnown: boolean; w: string; h: string; d: string; facade: string; countertop: string; hardware: string };

function advancedFrom(d: RequestDetails): AdvancedState {
  const unknown = new Set(d.unknown ?? []);
  return {
    sizeKnown: Boolean(d.widthCm),
    w: d.widthCm?.toString() ?? "",
    h: d.heightCm?.toString() ?? "",
    d: d.depthCm?.toString() ?? "",
    facade: d.facade ?? UNKNOWN,
    // Столешница не выбрана и не помечена «не знаю» — значит, не нужна (как переносит помощник).
    countertop: d.countertop ?? (unknown.has("countertop") || !d.facade ? UNKNOWN : "none"),
    hardware: d.hardware ?? UNKNOWN,
  };
}

const toCm = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const options = (book: Record<string, { name: string }>) => [
  { value: UNKNOWN, label: w.unknown },
  ...Object.entries(book).map(([value, o]) => ({ value, label: o.name })),
];

/**
 * «Для продвинутых» (решение 2.2.11): свёрнутый блок с техническими полями — размеры, ЛДСП/МДФ, столешница,
 * фурнитура. У каждого поля по умолчанию «Не знаю — подскажет исполнитель». Не открывали — ничего не меняется.
 */
function Advanced(props: {
  state: AdvancedState;
  onChange: (patch: Partial<AdvancedState>) => void;
  errors: Errors;
  calculator: boolean;
  /** Онлайн-замер (сценарий 5, флаг preContractFlows): блок открыт, размеры нужны для отправки. */
  selfMeasure: boolean;
}) {
  const a = w.advanced;
  const s = props.state;
  // Раскрыт с самого начала, если там уже что-то указано: свёрнутый блок не прячет сохранённые данные.
  const [openAtStart] = useState(props.selfMeasure || s.sizeKnown || s.facade !== UNKNOWN || s.hardware !== UNKNOWN);
  return (
    <details className="group rounded-card border border-line bg-surface p-4 sm:p-5" open={openAtStart}>
      <summary className="flex min-h-control-sm cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-col justify-center">
          <span className="text-lg font-bold text-primary">{a.title}</span>
          <span className="text-base text-ink-soft">{a.hint}</span>
        </span>
        {/* Свёрнуто или раскрыто — видно по стрелке, как у остальных раскрывающихся блоков. */}
        <ChevronDown aria-hidden className="size-6 shrink-0 text-primary transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-5 flex flex-col gap-5">
        {props.selfMeasure && <SelfMeasureGuide />}
        <RadioCards
          label={w.size.modeLabel}
          name="sizeMode"
          value={s.sizeKnown ? "known" : "unknown"}
          onChange={(v) => props.onChange({ sizeKnown: v === "known" })}
          columns={2}
          options={[
            { value: "unknown", label: w.size.unknown, description: w.size.unknownHint },
            { value: "known", label: w.size.known, description: w.size.knownHint },
          ]}
        />
        {s.sizeKnown && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
            <Input label={w.size.width} inputMode="numeric" autoComplete="off" value={s.w} onChange={(e) => props.onChange({ w: e.target.value })} error={first(props.errors, "size")} />
            <Input label={w.size.height} optional inputMode="numeric" autoComplete="off" value={s.h} onChange={(e) => props.onChange({ h: e.target.value })} />
            <Input label={w.size.depth} optional inputMode="numeric" autoComplete="off" value={s.d} onChange={(e) => props.onChange({ d: e.target.value })} />
          </div>
        )}
        <Select label={ru.requests.facts.facade} placeholder={false} value={s.facade} onChange={(e) => props.onChange({ facade: e.target.value })} options={options(FACADES)} />
        <Select
          label={ru.requests.facts.countertop}
          placeholder={false}
          value={s.countertop}
          onChange={(e) => props.onChange({ countertop: e.target.value })}
          options={[...options(COUNTERTOPS), { value: "none", label: a.noCountertop }]}
        />
        <Select label={ru.requests.facts.hardware} placeholder={false} value={s.hardware} onChange={(e) => props.onChange({ hardware: e.target.value })} options={options(HARDWARE)} />
        {props.calculator && <p className="text-base text-ink-soft">{a.calculatorHint}</p>}
      </div>
    </details>
  );
}

/**
 * Первый экран мастера: тип мебели и стиль (картинки вместо терминов), всё техническое — в свёрнутом «Для продвинутых».
 * Примеры стиля — по выбранному типу (фото работ того же типа, иначе иллюстрации стиля).
 */
export function StartStep(
  props: StepBase & {
    types: readonly FurnitureType[];
    examples: Readonly<Record<string, readonly StyleExample[]>>;
    initial: StartInitial;
    note?: ReactNode;
    calculator: boolean;
    selfMeasure: boolean;
  },
) {
  const { submit, pending, error, errors } = useStep(props);
  const { furnitureTypeId, customType } = props.initial;
  const isPopular = POPULAR_FURNITURE_TYPES.some((slug) => props.types.find((t) => t.slug === slug)?.id === furnitureTypeId);
  const [type, setType] = useState({
    main: isPopular && furnitureTypeId ? furnitureTypeId : furnitureTypeId || customType ? OTHER : "",
    sub: !isPopular && furnitureTypeId ? furnitureTypeId : customType ? CUSTOM : "",
    custom: customType ?? "",
  });
  const [style, setStyle] = useState(props.initial.style ?? "");
  const [advanced, setAdvanced] = useState(() => advancedFrom(props.initial.details));
  const [touched, setTouched] = useState(false);

  const typeId = type.main === OTHER ? (type.sub && type.sub !== CUSTOM ? type.sub : null) : type.main || null;
  const examples = props.examples[typeId ?? ""] ?? props.examples[""] ?? [];
  const chosenStyle = examples.find((e) => e.style === style)?.style ?? null;
  const s = advanced;
  return (
    <StepForm
      errors={errors}
      onSubmit={() =>
        submit({
          screen: "start",
          furnitureTypeId: typeId,
          customType: type.main === OTHER && type.sub === CUSTOM ? type.custom : null,
          style: chosenStyle,
          advanced: touched
            ? {
                size: s.sizeKnown ? { mode: "known", widthCm: toCm(s.w), heightCm: toCm(s.h), depthCm: toCm(s.d) } : { mode: "unknown" },
                facade: s.facade,
                countertop: s.countertop,
                hardware: s.hardware,
              }
            : null,
        })
      }
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={w.start.title} lead={w.start.lead} />
      {props.note}
      <TypeChoice types={props.types} {...type} onChange={(patch) => setType({ ...type, ...patch })} errors={errors} />
      <RadioCards
        label={w.style.label}
        hint={w.style.lead}
        name="style"
        value={style}
        onChange={setStyle}
        columns={3}
        error={first(errors, "style")}
        options={examples.map((e) => ({
          value: e.style,
          label: STYLES[e.style].hint,
          description: w.style.styleName(STYLES[e.style].name),
          image: { src: e.src },
        }))}
      />
      <Advanced
        state={advanced}
        onChange={(patch) => {
          setTouched(true);
          setAdvanced({ ...advanced, ...patch });
        }}
        errors={errors}
        calculator={props.calculator}
        selfMeasure={props.selfMeasure}
      />
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 2. Какой уровень? ───────────────────────────────────────────────────────

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
