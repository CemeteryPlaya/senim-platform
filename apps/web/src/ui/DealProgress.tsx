import { AlertTriangle, Check, Undo2, XCircle } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { DealStatus } from "@/generated/prisma/enums";
import { cn } from "./cn";
import { dealProgressView } from "./deal-progress";

const t = ru.common.ui.dealProgress;

export type DealProgressProps = { status: DealStatus; hasOpenDispute: boolean; className?: string };

/**
 * Пять шагов сделки «Оплата → Работа → Готово → Приёмка → Выплата» (спека 8а).
 * Упорядоченный список; текущий шаг — aria-current="step"; пройденные озвучены скрытым текстом;
 * смысл несут галочка, номер и подпись, а не цвет. Отмена и возврат — плашка вместо шагов.
 */
export function DealProgress({ status, hasOpenDispute, className }: DealProgressProps) {
  const view = dealProgressView(status, hasOpenDispute);
  if (view.kind === "banner") {
    const cancelled = view.tone === "cancelled";
    return (
      <p role="status" className={cn("flex items-center gap-2 rounded-card bg-sunken p-4 text-base font-semibold text-ink", className)}>
        {cancelled ? <XCircle aria-hidden className="size-6 shrink-0" /> : <Undo2 aria-hidden className="size-6 shrink-0" />}
        {cancelled ? t.cancelled : t.refunded}
      </p>
    );
  }
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ol aria-label={t.label} className="grid grid-cols-[repeat(auto-fit,minmax(min(6rem,100%),1fr))] gap-x-2 gap-y-3">
        {t.steps.map((name, i) => {
          const done = i < view.current;
          const current = i === view.current;
          return (
            <li key={name} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
              <span aria-hidden className={cn("block h-1.5 rounded-badge", done || current ? (view.muted ? "bg-muted" : "bg-primary") : "bg-line")} />
              <span className={cn("flex items-center gap-1 text-sm break-words", current ? "font-bold text-ink" : done ? "text-ink-soft" : "text-muted")}>
                {done ? <Check aria-hidden className="size-4 shrink-0" /> : <span aria-hidden>{i + 1}.</span>}
                {name}
                {done && <span className="sr-only">{t.done}</span>}
                {current && <span className="sr-only">{t.current}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {view.muted && (
        <p role="status" className="flex items-center gap-2 rounded-card bg-warning-soft p-4 text-base font-semibold text-warning">
          <AlertTriangle aria-hidden className="size-6 shrink-0" />
          {t.dispute}
        </p>
      )}
    </div>
  );
}
