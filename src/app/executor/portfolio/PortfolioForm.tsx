"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ru } from "@/i18n/ru";
import { Alert, Button, Checkbox, Input, RadioCards, Select, Textarea } from "@/ui";
import { STYLES, type StyleKey } from "@/verticals/furniture";
import { createWork, updateWork } from "./actions";

/** Как PLACE_MAX в companies (сервер проверяет сам; здесь — только ограничение поля). */
const PLACE_MAX = 80;

const t = ru.companies.portfolio;

export type PortfolioFormValues = {
  furnitureTypeId: string;
  style: StyleKey | "";
  title: string;
  description: string;
  priceFrom: number | null;
  published: boolean;
  place: string;
};

type Props = {
  /** Нет id — создание: после сохранения переходим на страницу работы, чтобы добавить фото. */
  itemId?: string;
  initial: PortfolioFormValues;
  types: { id: string; name: string }[];
};

function toPrice(raw: string): number | null {
  const clean = raw.replace(/[\s ]/g, "");
  return clean === "" ? null : Number(clean);
}

export function PortfolioForm({ itemId, initial, types }: Props) {
  const router = useRouter();
  const [values, setValues] = useState({ ...initial, price: initial.priceFrom === null ? "" : String(initial.priceFrom) });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const input = {
      furnitureTypeId: values.furnitureTypeId,
      style: values.style as StyleKey,
      title: values.title,
      description: values.description,
      priceFrom: toPrice(values.price),
      published: values.published,
      place: values.place,
    };
    startTransition(async () => {
      const result = itemId ? await updateWork({ id: itemId, ...input }) : await createWork(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setNotice({ tone: "danger", text: result.error });
        return;
      }
      setErrors({});
      if (!itemId && result.data && "id" in result.data) {
        router.push(`/executor/portfolio/${result.data.id}`);
        return;
      }
      setNotice({ tone: "success", text: result.data?.masked ? `${t.saved}. ${t.masked}` : t.saved });
      router.refresh();
    });
  };

  const err = (key: string) => errors[key]?.[0];

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Select
        label={t.fields.type}
        value={values.furnitureTypeId}
        onChange={(e) => set("furnitureTypeId", e.target.value)}
        options={types.map((ft) => ({ value: ft.id, label: ft.name }))}
        error={err("furnitureTypeId")}
      />
      <RadioCards
        label={t.fields.style}
        name="style"
        value={values.style}
        onChange={(v) => set("style", v as StyleKey)}
        options={Object.entries(STYLES).map(([value, s]) => ({ value, label: s.name, description: s.hint }))}
        columns={2}
        error={err("style")}
      />
      <Input label={t.fields.title} hint={t.fields.titleHint} value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={120} error={err("title")} />
      <Textarea
        label={t.fields.description}
        hint={t.fields.descriptionHint}
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
        rows={5}
        maxLength={2000}
        optional
        error={err("description")}
      />
      <Input
        label={t.fields.place}
        hint={t.fields.placeHint}
        value={values.place}
        onChange={(e) => set("place", e.target.value)}
        maxLength={PLACE_MAX}
        optional
        error={err("place")}
      />
      <Input
        label={t.fields.price}
        hint={t.fields.priceHint}
        type="text"
        inputMode="numeric"
        value={values.price}
        onChange={(e) => set("price", e.target.value)}
        optional
        error={err("priceFrom")}
        className="max-w-60"
      />
      <Checkbox label={t.fields.published} checked={values.published} onChange={(e) => set("published", e.target.checked)} />

      {notice && (
        <Alert tone={notice.tone} live={notice.tone === "danger" ? "assertive" : "polite"}>
          {notice.text}
        </Alert>
      )}

      <div>
        <Button type="submit" loading={pending}>
          {itemId ? t.save : t.create}
        </Button>
      </div>
    </form>
  );
}
