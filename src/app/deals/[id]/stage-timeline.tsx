import clsx from "clsx";
import { Check, Coins } from "lucide-react";
import type { DealFull } from "@/lib/deal/query";
import { STAGE_STATUS } from "@/lib/deal/labels";
import { trancheFor } from "@/lib/deal/money";
import { dateTime, tenge } from "@/lib/format";
import { Badge } from "@/components/ui";
import { PhotoGrid } from "@/components/photo-grid";

export function StageTimeline({ deal }: { deal: DealFull }) {
  return (
    <ol className="relative space-y-3">
      {deal.stages.map((stage, i) => {
        const st = STAGE_STATUS[stage.status];
        const isLast = i === deal.stages.length - 1;
        const done = stage.status === "APPROVED";
        const active = stage.status !== "PENDING" && !done;
        return (
          <li key={stage.id} className="relative flex gap-4">
            {!isLast && <span className={clsx("absolute top-9 bottom-[-12px] left-[15px] w-0.5", done ? "bg-brand" : "bg-line")} />}
            <span
              className={clsx(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                done && "border-brand bg-brand text-white",
                active && "border-accent bg-accent-soft text-accent",
                stage.status === "PENDING" && "border-line bg-surface text-muted",
              )}
            >
              {done ? <Check size={16} /> : stage.order}
            </span>
            <div
              className={clsx(
                "min-w-0 flex-1 rounded-2xl border bg-surface p-4",
                active ? "border-accent/50 shadow-sm" : "border-line",
                stage.status === "PENDING" && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold">{stage.title}</div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{stage.description}</p>
              {(stage.payoutPercent > 0 || isLast) && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
                  <Coins size={13} className="text-accent" />
                  {isLast
                    ? "После приёмки мастеру раскрывается остаток суммы"
                    : `После подтверждения раскрывается ${stage.payoutPercent}% — ${tenge(trancheFor(deal.amount, stage.payoutPercent))}`}
                </div>
              )}
              {stage.report && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                  <div className="mb-1 text-xs text-muted">
                    Отчёт мастера{stage.submittedAt && ` · ${dateTime(stage.submittedAt)}`}
                  </div>
                  {stage.report}
                  {stage.photos.length > 0 && <PhotoGrid photos={stage.photos} className="mt-2.5" />}
                </div>
              )}
              {stage.status === "REWORK" && stage.clientNote && (
                <div className="mt-2 rounded-xl bg-red-soft p-3 text-sm text-red">Замечания заказчика: {stage.clientNote}</div>
              )}
              {stage.approvedAt && <div className="mt-2 text-xs text-brand">Принят заказчиком {dateTime(stage.approvedAt)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
