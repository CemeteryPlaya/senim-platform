"use client";

import { ArrowRight } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import {
  COUNTERTOP_KEYS,
  EXTRAS,
  FACADE_KEYS,
  HARDWARE_KEYS,
  LIMITS,
  SEGMENTS,
  STYLE_KEYS,
  stepInputSchema,
  type Extra,
  type RequestDetails,
  type WizardScreen,
} from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { Button, Checkbox, Input, RadioCards, Select, Textarea } from "@/ui";
import { COUNTERTOPS, FACADES, HARDWARE, SEGMENT_NAMES, STYLES } from "@/verticals/furniture";
import { saveStepAction, submitRequestAction } from "../actions";
import { FormError, useRunAction } from "../_parts/ActionButton";
import { SEGMENT_IMAGES, STYLE_IMAGES } from "../_parts/labels";

const w = ru.requests.wizard;
const CUSTOM = "__custom";

type Errors = Record<string, string[] | undefined>;

type StepBase = { draftId: string | null; like: string | null; next: WizardScreen | null };

/** Проверка шага той же схемой, что и на сервере, затем сохранение черновика и переход дальше. */
function useStep({ draftId, like, next }: StepBase) {
  const [errors, setErrors] = useState<Errors>({});
  const { run, pending, error } = useRunAction(saveStepAction, (d) => `/requests/new?draft=${d.requestId}&step=${next}`);
  /** Сырые значения формы: разбирает их схема шага (граница — здесь и на сервере). */
  const submit = (step: { screen: WizardScreen } & Record<string, unknown>) => {
    const parsed = stepInputSchema.safeParse(step);
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as Errors);
      return;
    }
    setErrors({});
    void run({ requestId: draftId, like: draftId ? null : like, step: parsed.data });
  };
  return { submit, pending, error, errors };
}

const first = (errors: Errors, key: string) => errors[key]?.[0];

function StepHeading({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
      <p className="text-lg text-muted">{lead}</p>
    </div>
  );
}

function StepForm({ onSubmit, children, actions }: { onSubmit: () => void; children: ReactNode; actions: ReactNode }) {
  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form noValidate onSubmit={handle} className="flex flex-col gap-8">
      {children}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{actions}</div>
    </form>
  );
}

function NextButton({ pending, label = w.next }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" loading={pending} iconEnd={<ArrowRight />} className="sm:min-w-56">
      {label}
    </Button>
  );
}

// ─── 1. Что делаем ───────────────────────────────────────────────────────────

export function TypeStep(props: StepBase & { types: { id: string; name: string }[]; initial: { furnitureTypeId: string | null; customType: string | null }; note?: ReactNode }) {
  const { submit, pending, error, errors } = useStep(props);
  const [choice, setChoice] = useState(props.initial.furnitureTypeId ?? (props.initial.customType ? CUSTOM : ""));
  const [custom, setCustom] = useState(props.initial.customType ?? "");
  const options = [
    ...props.types.map((t) => ({ value: t.id, label: t.name })),
    { value: CUSTOM, label: w.type.customOption, description: w.type.customOptionHint },
  ];
  return (
    <StepForm
      onSubmit={() =>
        submit({
          screen: "type",
          furnitureTypeId: choice && choice !== CUSTOM ? choice : null,
          customType: choice === CUSTOM ? custom : null,
        })
      }
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={w.type.title} lead={w.type.lead} />
      {props.note}
      <RadioCards label={w.type.label} name="furnitureType" options={options} value={choice} onChange={setChoice} columns={3} error={first(errors, "furnitureTypeId")} />
      {choice === CUSTOM && (
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

// ─── 2. Стиль ────────────────────────────────────────────────────────────────

export function StyleStep(props: StepBase & { initial: { style: string | null; styleNote: string } }) {
  const { submit, pending, error, errors } = useStep(props);
  const [choice, setChoice] = useState(props.initial.style ?? (props.initial.styleNote ? CUSTOM : ""));
  const [note, setNote] = useState(props.initial.styleNote);
  const options = [
    ...STYLE_KEYS.map((key) => ({
      value: key,
      label: STYLES[key].name,
      description: STYLES[key].hint,
      image: { src: STYLE_IMAGES[key], alt: w.style.imageAlt(STYLES[key].name) },
    })),
    { value: CUSTOM, label: w.custom, description: w.style.customOptionHint },
  ];
  const style = choice && choice !== CUSTOM ? (choice as (typeof STYLE_KEYS)[number]) : null;
  return (
    <StepForm
      onSubmit={() => submit({ screen: "style", style, styleNote: choice === CUSTOM ? note : "" })}
      actions={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => submit({ screen: "style", style: null, styleNote: "" })}>
            {w.skip}
          </Button>
          <NextButton pending={pending} />
        </>
      }
    >
      <StepHeading title={w.style.title} lead={w.style.lead} />
      <RadioCards label={w.style.label} name="style" options={options} value={choice} onChange={setChoice} columns={2} error={first(errors, "style")} />
      {choice === CUSTOM && (
        <Textarea
          label={w.style.noteLabel}
          hint={w.style.noteHint}
          value={note}
          maxLength={LIMITS.styleNote}
          onChange={(e) => setNote(e.target.value)}
          error={first(errors, "styleNote")}
        />
      )}
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 3. Помещение ────────────────────────────────────────────────────────────

export function RoomStep(props: StepBase & { photos: { id: string; src: string }[]; aiSlot?: ReactNode }) {
  const { submit, pending, error } = useStep(props);
  // INTEGRATOR: id файлов приходят из <Uploader purpose="REQUEST_ROOM" … onChange={setPhotoIds} /> (_components/uploader).
  const [photoIds] = useState(props.photos.map((p) => p.id));
  const save = () => submit({ screen: "room", photoFileIds: photoIds });
  return (
    <StepForm
      onSubmit={save}
      actions={
        <>
          <Button variant="secondary" disabled={pending} onClick={save}>
            {w.skip}
          </Button>
          <NextButton pending={pending} />
        </>
      }
    >
      <StepHeading title={w.room.title} lead={w.room.lead} />
      <section aria-label={w.room.photosLabel} className="flex flex-col gap-3">
        {/* INTEGRATOR: здесь <Uploader> от platform-engineer: «Сфотографировать», «Загрузить фото», «Использовать чертёж». */}
        {props.photos.length > 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-3">
            {props.photos.map((p, i) => (
              <li key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- адрес файла приходит из хранилища, размеры неизвестны */}
                <img src={p.src} alt={w.room.photoAlt(i + 1)} className="aspect-square w-full rounded-card border border-line object-cover" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-ink-soft">{w.room.none}</p>
        )}
      </section>
      {props.aiSlot}
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 4. Детали, часть 1: размеры ─────────────────────────────────────────────

const toCm = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function SizeStep(props: StepBase & { details: RequestDetails }) {
  const { submit, pending, error, errors } = useStep(props);
  const d = props.details;
  const [mode, setMode] = useState<"known" | "unknown">(d.unknown?.includes("size") ? "unknown" : "known");
  const [size, setSize] = useState({ w: d.widthCm?.toString() ?? "", h: d.heightCm?.toString() ?? "", d: d.depthCm?.toString() ?? "" });
  const sizeError = first(errors, "size");
  const field = (key: "w" | "h" | "d", label: string, required: boolean) => (
    <Input
      label={label}
      optional={!required}
      inputMode="numeric"
      autoComplete="off"
      value={size[key]}
      onChange={(e) => setSize({ ...size, [key]: e.target.value })}
      error={key === "w" ? sizeError : undefined}
    />
  );
  return (
    <StepForm
      onSubmit={() =>
        submit({
          screen: "size",
          size: mode === "unknown" ? { mode } : { mode, widthCm: toCm(size.w), heightCm: toCm(size.h), depthCm: toCm(size.d) },
        })
      }
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={w.size.title} lead={w.size.lead} />
      <p className="text-base font-semibold text-muted">{w.detailsPart(1)}</p>
      <RadioCards
        label={w.size.modeLabel}
        name="sizeMode"
        value={mode}
        onChange={(v) => setMode(v === "unknown" ? "unknown" : "known")}
        columns={2}
        options={[
          { value: "known", label: w.size.known, description: w.size.knownHint },
          { value: "unknown", label: w.unknown, description: w.size.unknownHint },
        ]}
      />
      {mode === "known" && (
        <div className="grid gap-4 sm:grid-cols-3">
          {field("w", w.size.width, true)}
          {field("h", w.size.height, false)}
          {field("d", w.size.depth, false)}
        </div>
      )}
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 5. Детали, часть 2: материалы ───────────────────────────────────────────

type Named = Record<string, { name: string }>;
const choiceOptions = (keys: readonly string[], names: Named, extra: { value: string; label: string }[] = []) => [
  ...keys.map((k) => ({ value: k, label: names[k].name })),
  ...extra,
  { value: "unknown", label: w.unknown },
];

function initialChoice(d: RequestDetails, key: "facade" | "countertop" | "hardware", hasRest: boolean): string {
  if (d[key]) return d[key];
  if (d.unknown?.includes(key)) return "unknown";
  return key === "countertop" && hasRest ? "none" : "";
}

export function MaterialsStep(props: StepBase & { details: RequestDetails }) {
  const { submit, pending, error, errors } = useStep(props);
  const d = props.details;
  const answered = Boolean(d.facade || d.hardware || d.unknown?.includes("facade"));
  const [form, setForm] = useState({
    facade: initialChoice(d, "facade", answered),
    countertop: initialChoice(d, "countertop", answered),
    hardware: initialChoice(d, "hardware", answered),
    color: d.color ?? "",
    extras: new Set<Extra>(d.extras ?? []),
    description: d.description ?? "",
  });
  const m = w.materials;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const toggle = (x: Extra, on: boolean) => {
    const extras = new Set(form.extras);
    if (on) extras.add(x);
    else extras.delete(x);
    set({ extras });
  };
  return (
    <StepForm
      onSubmit={() =>
        submit({
          screen: "materials",
          facade: form.facade,
          countertop: form.countertop,
          hardware: form.hardware,
          color: form.color,
          extras: EXTRAS.filter((x) => form.extras.has(x)),
          description: form.description,
        })
      }
      actions={<NextButton pending={pending} />}
    >
      <StepHeading title={m.title} lead={m.lead} />
      <p className="text-base font-semibold text-muted">{w.detailsPart(2)}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Select label={m.facade} value={form.facade} onChange={(e) => set({ facade: e.target.value })} options={choiceOptions(FACADE_KEYS, FACADES)} error={first(errors, "facade")} />
        <Select
          label={m.countertop}
          value={form.countertop}
          onChange={(e) => set({ countertop: e.target.value })}
          options={choiceOptions(COUNTERTOP_KEYS, COUNTERTOPS, [{ value: "none", label: m.countertopNone }])}
          error={first(errors, "countertop")}
        />
        <Select label={m.hardware} value={form.hardware} onChange={(e) => set({ hardware: e.target.value })} options={choiceOptions(HARDWARE_KEYS, HARDWARE)} error={first(errors, "hardware")} />
        <Input label={m.color} hint={m.colorHint} optional value={form.color} maxLength={LIMITS.color} onChange={(e) => set({ color: e.target.value })} error={first(errors, "color")} />
      </div>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-2 text-base font-semibold text-ink">{m.extras}</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {EXTRAS.map((x) => (
            <Checkbox key={x} label={ru.requests.extras[x]} checked={form.extras.has(x)} onChange={(e) => toggle(x, e.target.checked)} />
          ))}
        </div>
      </fieldset>
      <Textarea
        label={m.description}
        hint={`${m.descriptionHint}. ${m.counter(form.description.length, LIMITS.description)}`}
        optional
        value={form.description}
        maxLength={LIMITS.description}
        onChange={(e) => set({ description: e.target.value })}
        error={first(errors, "description")}
      />
      <FormError message={error} />
    </StepForm>
  );
}

// ─── 6. Уровень и отправка ───────────────────────────────────────────────────

export type SendInitial = { segment: string; city: string; address: string; desiredDate: string; wishes: string };

export function SendStep(props: { draftId: string; initial: SendInitial; suggestion: ReactNode; summary: ReactNode; directNumber: number | null }) {
  const s = w.send;
  const [form, setForm] = useState(props.initial);
  const [errors, setErrors] = useState<Errors>({});
  const { run, pending, error } = useRunAction(submitRequestAction, (d) => `/requests/${d.requestId}?sent=1`);
  const set = (patch: Partial<SendInitial>) => setForm({ ...form, ...patch });
  const send = () => {
    const parsed = stepInputSchema.safeParse({
      screen: "send",
      segment: form.segment || undefined,
      city: form.city,
      address: form.address,
      desiredDate: form.desiredDate || null,
      wishes: form.wishes,
    });
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as Errors);
      return;
    }
    setErrors({});
    void run({ requestId: props.draftId, step: parsed.data });
  };
  const options = SEGMENTS.map((key) => ({
    value: key,
    label: SEGMENT_NAMES[key],
    description: s.segmentHint[key],
    image: { src: SEGMENT_IMAGES[key], alt: s.segmentImageAlt(SEGMENT_NAMES[key]) },
  }));
  const chosen = SEGMENTS.find((k) => k === form.segment);
  return (
    <StepForm
      onSubmit={send}
      actions={
        <div className="flex w-full flex-col gap-2 sm:items-end">
          <NextButton pending={pending} label={s.submit} />
          {props.directNumber !== null ? (
            <p className="text-sm text-muted">{s.footnoteDirect(props.directNumber)}</p>
          ) : (
            chosen && <p className="text-sm text-muted">{s.footnote(SEGMENT_NAMES[chosen])}</p>
          )}
        </div>
      }
    >
      <StepHeading title={s.title} lead={props.directNumber !== null ? s.leadDirect(props.directNumber) : s.lead} />
      {props.suggestion}
      <RadioCards label={s.segmentLabel} name="segment" options={options} value={form.segment} onChange={(v) => set({ segment: v })} columns={3} error={first(errors, "segment")} />
      {props.summary}
      <section className="flex flex-col gap-5" aria-labelledby="send-more">
        <h2 id="send-more" className="text-xl font-bold text-ink">
          {s.more}
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label={s.city} value={form.city} autoComplete="address-level2" onChange={(e) => set({ city: e.target.value })} error={first(errors, "city")} />
          <Input label={s.desiredDate} type="date" optional value={form.desiredDate} onChange={(e) => set({ desiredDate: e.target.value })} error={first(errors, "desiredDate")} />
        </div>
        <Input label={s.address} hint={s.addressHint} value={form.address} autoComplete="street-address" maxLength={LIMITS.address} onChange={(e) => set({ address: e.target.value })} error={first(errors, "address")} />
        <Textarea
          label={s.wishes}
          hint={`${s.wishesHint}. ${w.materials.counter(form.wishes.length, LIMITS.wishes)}`}
          optional
          value={form.wishes}
          maxLength={LIMITS.wishes}
          onChange={(e) => set({ wishes: e.target.value })}
          error={first(errors, "wishes")}
        />
      </section>
      <FormError message={error} />
    </StepForm>
  );
}
