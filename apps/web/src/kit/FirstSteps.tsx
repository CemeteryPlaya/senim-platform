import Link from "next/link";
import { Check } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { cn } from "./cn";
import { Progress } from "./Progress";

export type FirstStep = { label: string; done: boolean; href?: string };

/** Список первых шагов. Исчезает (null), когда все шаги пройдены или шагов нет. */
export function FirstSteps({ steps }: { steps: FirstStep[] }) {
  const left = steps.filter((step) => !step.done).length;
  if (steps.length === 0 || left === 0) return null;
  const t = ru.app.kit.firstSteps;
  return (
    <Card as="section">
      <h2 className="text-card text-ink">{t.left(left)}</h2>
      <div className="mt-3">
        <Progress value={steps.length - left} max={steps.length} label={t.progressLabel} />
      </div>
      <ul className="mt-2">
        {steps.map((step, index) => {
          const row = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  step.done ? "border-accent bg-accent text-on-action" : "border-line-strong",
                )}
              >
                {step.done && <Check className="size-4" />}
              </span>
              <span className={cn("min-w-0", step.done ? "text-muted" : "text-ink")}>
                {step.label}
                {step.done && <span className="sr-only">{`. ${t.doneMark}`}</span>}
              </span>
            </>
          );
          const rowClass = "flex min-h-control items-center gap-3 text-body";
          return (
            <li key={`${index}-${step.label}`}>
              {step.href && !step.done ? (
                <Link href={step.href} className={cn(rowClass, "no-underline")}>
                  {row}
                </Link>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
