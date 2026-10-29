import clsx from "clsx";
import { Check } from "lucide-react";
import type { DealStatus } from "@/generated/prisma/enums";
import { STEPS, stepIndex } from "@/lib/deal/labels";

export function Stepper({ status }: { status: DealStatus }) {
  const current = stepIndex(status);
  const halted = status === "CANCELLED" || status === "REFUNDED";

  return (
    <ol className="mt-6 grid grid-cols-5 gap-1.5">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current && !halted;
        return (
          <li key={step.key} className="min-w-0">
            <div
              className={clsx(
                "h-1.5 rounded-full",
                done ? "bg-brand" : active ? (status === "DISPUTE" ? "bg-red" : "bg-accent") : "bg-ink/10",
              )}
            />
            <div className={clsx("mt-2 flex items-center gap-1 text-xs", active ? "font-semibold text-ink" : "text-muted")}>
              {done && <Check size={12} className="shrink-0 text-brand" />}
              <span className="truncate">{step.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
