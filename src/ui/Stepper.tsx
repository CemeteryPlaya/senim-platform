"use client";

import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type StepperBack = { href: string } | { onClick: () => void };

export type StepperProps = {
  /** Названия шагов по порядку. */
  steps: readonly string[];
  /** Текущий шаг, считая с нуля. */
  current: number;
  /**
   * «Назад» есть на каждом шаге мастера: ссылка или обработчик. На первом шаге — выход из мастера.
   * Без back — только шкала шагов (этапы заявки на экране, где «Назад» уже есть в заголовке).
   */
  back?: StepperBack;
  backLabel?: string;
  /** Подпись навигации для диктора. */
  label?: string;
  className?: string;
};

/**
 * Единый степпер мастера (по макетам): кружки с линиями — пройденные с галочкой,
 * текущий залит, будущие пустые и соединены пунктиром. Над ними — «Назад» и «Шаг N из M».
 * Подписи шагов видны с ширины sm; на телефоне название текущего шага — в строке «Шаг N из M».
 */
export function Stepper({ steps, current, back, backLabel = ru.common.actions.back, label = ru.common.ui.stepper.label, className }: StepperProps) {
  const index = Math.min(Math.max(current, 0), steps.length - 1);
  const backClass =
    "-ml-2 inline-flex min-h-control-sm items-center gap-2 self-start rounded-control px-2 text-base font-semibold text-ink no-underline hover:bg-sunken";
  const backContent = (
    <>
      <ArrowLeft aria-hidden className="size-6 shrink-0" />
      {backLabel}
    </>
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {back === undefined ? null : "href" in back ? (
        <Link href={back.href} className={backClass}>
          {backContent}
        </Link>
      ) : (
        <button type="button" onClick={back.onClick} className={cn(backClass, "bg-transparent")}>
          {backContent}
        </button>
      )}

      <nav aria-label={label}>
        <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((step, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li
                key={step}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "relative flex min-w-0 flex-col items-center gap-2",
                  // Линия от предыдущего шага: сплошная — до текущего, пунктир — дальше.
                  i > 0 && "before:absolute before:top-3.5 before:right-1/2 before:w-full before:-translate-y-1/2 before:border-t-2",
                  i > 0 && (i <= index ? "before:border-primary" : "before:border-dashed before:border-line-strong"),
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative z-10 inline-flex size-7 items-center justify-center rounded-full",
                    done && "bg-primary text-on-primary",
                    active && "bg-primary ring-4 ring-accent-soft",
                    !done && !active && "border-2 border-line-strong bg-surface",
                  )}
                >
                  {done && <Check className="size-4" strokeWidth={3} />}
                </span>
                {/* Для диктора — одна строка «Стиль: пройден»: из соседних элементов браузер собрал бы «Стиль : пройден». */}
                <span aria-hidden className={cn("hidden text-center text-sm break-words sm:block", active ? "font-bold text-primary" : "text-muted")}>
                  {step}
                </span>
                <span className="sr-only">{done ? ru.common.ui.stepper.doneStep(step) : step}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      <p className="text-base text-ink">
        <span className="text-muted">{ru.common.ui.stepper.progress(index + 1, steps.length)}: </span>
        <span className="font-bold">{steps[index]}</span>
      </p>
    </div>
  );
}
