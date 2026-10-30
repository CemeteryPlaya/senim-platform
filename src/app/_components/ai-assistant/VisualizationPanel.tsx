"use client";

import { Wand2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { ru } from "@/i18n/ru";
import { VISUALIZE_PROMPT_MAX, type VisualizationList, type VisualizationView } from "@/modules/ai/client";
import { Button, RadioCards, StatusBadge, Textarea, type Tone } from "@/ui";
import { requestVisualizationAction } from "./actions";
import { VisualizationExample } from "./VisualizationExample";
import { mergeView, pendingIds } from "./visualization-state";

export type VisualizationPanelProps = {
  /** Заявка (DRAFT или OPEN) заказчика. */
  requestId: string;
  /** Фото помещения этой заявки (уже загружены через uploader). */
  photos: readonly { id: string; src: string }[];
  /** Начальный список и остаток лимита — из listVisualizations на сервере. */
  initial: VisualizationList;
  /** Период опроса статуса, мс. */
  pollIntervalMs?: number;
};

const t = ru.ai.visualization;

const TONE: Record<VisualizationView["status"], Tone> = { QUEUED: "neutral", RUNNING: "info", DONE: "success", FAILED: "danger" };

/** Блок ИИ-иллюстрации на шаге «Помещение»: выбор фото, пожелания, очередь и результаты с пометкой. */
export function VisualizationPanel({ requestId, photos, initial, pollIntervalMs = 3000 }: VisualizationPanelProps) {
  const [items, setItems] = useState<VisualizationView[]>(initial.items);
  const [remaining, setRemaining] = useState(initial.remaining);
  const [sourceId, setSourceId] = useState(photos[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  usePolling(items, setItems, pollIntervalMs);

  const sourceIndex = Math.max(0, photos.findIndex((p) => p.id === sourceId));
  const canSubmit = photos.length > 0 && remaining > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await requestVisualizationAction({ requestId, sourceFileId: photos[sourceIndex].id, prompt });
      if (!res.ok) return setError(res.fieldErrors?.prompt?.[0] ?? res.error);
      setItems((prev) => mergeView(prev, res.data));
      setRemaining((r) => Math.max(0, r - 1));
      setPrompt("");
    });
  }

  return (
    <section aria-labelledby="ai-visualization-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 id="ai-visualization-title" className="flex items-center gap-2 text-xl font-semibold text-ink">
        <Wand2 aria-hidden className="size-6 shrink-0 text-primary" />
        {t.title}
      </h2>
      <p className="text-base text-ink-soft">{t.description}</p>
      {items.length === 0 && <VisualizationExample />}

      <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
        {photos.length === 0 && <p className="text-base text-muted">{t.noPhotos}</p>}
        {photos.length > 1 && (
          <RadioCards
            label={t.chooseSource}
            name="sourceFileId"
            columns={3}
            value={photos[sourceIndex].id}
            onChange={setSourceId}
            options={photos.map((p, i) => ({ value: p.id, label: t.sourceAlt(i + 1), image: { src: p.src } }))}
          />
        )}
        <Textarea
          label={t.promptLabel}
          hint={t.promptHint}
          optional
          name="prompt"
          rows={2}
          maxLength={VISUALIZE_PROMPT_MAX}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          error={error ?? undefined}
        />
        <p className="text-sm text-muted" aria-live="polite">
          {remaining > 0 ? t.remaining(remaining) : t.limitReached}
        </p>
        <Button type="submit" variant="secondary" loading={pending} disabled={!canSubmit} icon={<Wand2 aria-hidden className="size-5" />}>
          {t.submit}
        </Button>
      </form>

      {items.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label={t.title}>
          {items.map((v, i) => (
            <VisualizationItem key={v.id} view={v} number={items.length - i} />
          ))}
        </ul>
      )}
    </section>
  );
}

function VisualizationItem({ view, number }: { view: VisualizationView; number: number }) {
  return (
    <li className="flex flex-col gap-2 rounded-card bg-sunken p-3">
      <div aria-live="polite" className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={TONE[view.status]}>{t.status[view.status]}</StatusBadge>
        {view.prompt && <span className="min-w-0 break-words text-base text-ink-soft">{view.prompt}</span>}
      </div>
      {view.status === "FAILED" && view.error && <p className="text-base text-danger">{view.error}</p>}
      {view.results.map((r) => (
        <figure key={r.id} className="flex flex-col gap-2">
          {/* Картинка из хранилища по подписанной ссылке: размеры заранее неизвестны. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.url} alt={t.resultAlt(number)} className="w-full rounded-control object-cover" loading="lazy" />
          <figcaption className="flex flex-col gap-1">
            <StatusBadge tone="accent">{ru.ai.label}</StatusBadge>
            <span className="text-sm text-muted">{t.disclaimer}</span>
          </figcaption>
        </figure>
      ))}
    </li>
  );
}

/** Опрос статуса иллюстраций в очереди; останавливается, когда все готовы или упали. */
function usePolling(
  items: VisualizationView[],
  setItems: React.Dispatch<React.SetStateAction<VisualizationView[]>>,
  intervalMs: number,
) {
  const waiting = pendingIds(items).join(",");
  // Каждый круг опроса заканчивается новым tick — так следующий круг запускается и при неизменном списке.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const id of waiting.split(",")) {
        const res = await fetch(`/api/ai/visualizations/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        if (cancelled) return;
        if (!res?.ok) continue;
        const next = (await res.json()) as VisualizationView; // ответ нашего маршрута getVisualization
        if (!cancelled) setItems((prev) => mergeView(prev, next));
      }
      if (!cancelled) setTick((n) => n + 1);
    }, intervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waiting, tick, intervalMs, setItems]);
}
