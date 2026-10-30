"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { ASSIST_TEXT_MAX, type AssistResult, type RequestDraft } from "@/modules/ai/client";
import { Alert, Button, Checkbox, Textarea } from "@/ui";
import { assistAction } from "./actions";
import { pickFields, previewRows, type PreviewKey } from "./preview";

export type DescribeAssistantProps = {
  /** Черновик заявки (DRAFT), для которого работает помощник. */
  requestId: string;
  /** Справочник типов мебели — чтобы показать название вместо slug. */
  furnitureTypes: readonly { slug: string; name: string }[];
  /** Заказчик подтвердил поля: экран мастера переносит их в черновик заявки. */
  onApply: (draft: RequestDraft) => void;
};

type View = { kind: "form" } | { kind: "preview"; result: AssistResult } | { kind: "applied" };

const t = ru.ai.assistant;

/** «Опишите своими словами»: текст → поля заявки на проверку → перенос отмеченных полей. */
export function DescribeAssistant({ requestId, furnitureTypes, onApply }: DescribeAssistantProps) {
  const [text, setText] = useState("");
  const [view, setView] = useState<View>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await assistAction({ requestId, text });
      if (res.ok) setView({ kind: "preview", result: res.data });
      else setError(res.fieldErrors?.text?.[0] ?? res.error);
    });
  }

  return (
    <section aria-labelledby="ai-describe-title" className="flex flex-col gap-4 rounded-card bg-accent-soft p-5">
      <h2 id="ai-describe-title" className="flex items-center gap-2 text-xl font-semibold text-ink">
        <Sparkles aria-hidden className="size-6 shrink-0 text-primary" />
        {t.title}
      </h2>
      {view.kind === "form" && (
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
          <p className="text-base text-ink-soft">{t.description}</p>
          <Textarea
            label={t.inputLabel}
            hint={`${t.inputHint}. ${t.privacy}`}
            name="text"
            rows={5}
            maxLength={ASSIST_TEXT_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error ?? undefined}
            required
          />
          <Button type="submit" loading={pending} icon={<Sparkles aria-hidden className="size-5" />}>
            {pending ? t.pending : t.submit}
          </Button>
        </form>
      )}
      {view.kind === "preview" && (
        <Preview
          result={view.result}
          furnitureTypes={furnitureTypes}
          onApply={(draft) => {
            onApply(draft);
            setView({ kind: "applied" });
          }}
          onRetry={() => setView({ kind: "form" })}
        />
      )}
      {view.kind === "applied" && (
        <Alert
          tone="success"
          live="polite"
          action={
            <Button variant="ghost" onClick={() => setView({ kind: "form" })}>
              {t.again}
            </Button>
          }
        >
          {t.applied}
        </Alert>
      )}
    </section>
  );
}

function Preview({
  result,
  furnitureTypes,
  onApply,
  onRetry,
}: {
  result: AssistResult;
  furnitureTypes: DescribeAssistantProps["furnitureTypes"];
  onApply: (draft: RequestDraft) => void;
  onRetry: () => void;
}) {
  const names = useMemo(() => Object.fromEntries(furnitureTypes.map((f) => [f.slug, f.name])), [furnitureTypes]);
  const rows = useMemo(() => previewRows(result.draft, names), [result.draft, names]);
  const [checked, setChecked] = useState<ReadonlySet<PreviewKey>>(() => new Set(rows.map((r) => r.key)));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const toggle = (key: PreviewKey) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (rows.length === 0) {
    return (
      <Alert tone="info" live="polite" action={<Button variant="secondary" onClick={onRetry}>{t.again}</Button>}>
        {t.nothingFound}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink focus:outline-none">
        {t.previewTitle}
      </h3>
      <p className="text-base text-muted">{t.previewHint}</p>
      <fieldset className="flex flex-col gap-1 rounded-card bg-surface p-4">
        <legend className="sr-only">{t.previewTitle}</legend>
        {rows.map((row) => (
          <Checkbox
            key={row.key}
            name={row.key}
            checked={checked.has(row.key)}
            onChange={() => toggle(row.key)}
            label={
              <>
                <span className="text-muted">{row.label}: </span>
                <span className="font-medium">{row.value}</span>
              </>
            }
          />
        ))}
      </fieldset>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => onApply(pickFields(result.draft, checked))} disabled={checked.size === 0}>
          {t.apply}
        </Button>
        <Button variant="ghost" onClick={onRetry}>
          {t.again}
        </Button>
      </div>
    </div>
  );
}
