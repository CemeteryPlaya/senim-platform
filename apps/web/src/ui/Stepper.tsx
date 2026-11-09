"use client";

import Link from "next/link";
import { Check, ChevronLeft } from "lucide-react";
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
 * Шкала шагов по макетам 8–11: кружки с номерами, соединённые линией. Пройденные — зелёные с галочкой,
 * текущий — зелёный с номером и мятным ободком, будущие — белые с серой рамкой и номером; линия до текущего —
 * зелёная, дальше — серая. Подписи под кружками видны, когда им хватает ширины (контейнерный запрос в em:
 * при крупном системном шрифте подписи уходят раньше), а строка «Шаг N из M: …» под шкалой есть всегда.
 */
export function Stepper({ steps, current, back, backLabel = ru.common.actions.back, label = ru.common.ui.stepper.label, className }: StepperProps) {
  const index = Math.min(Math.max(current, 0), steps.length - 1);
  // Подписи под кружками: четыре шага помещаются на телефоне, пять и больше — с ширины планшета.
  const labelsFrom = steps.length <= 4 ? "@min-[21em]:block" : "@min-[34em]:block";
  const backClass =
    "-ml-2 inline-flex min-h-control-sm items-center gap-1 self-start rounded-control pr-3 pl-1 text-base font-semibold text-ink no-underline hover:bg-surface";
  const backContent = (
    <>
      <ChevronLeft aria-hidden className="size-6 shrink-0" />
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

      <nav aria-label={label} className="@container text-sm">
        <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((step, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li
                key={step}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "relative flex min-w-0 flex-col items-center gap-1.5",
                  // Линия от предыдущего шага к этому: зелёная — до текущего включительно, дальше серая.
                  i > 0 && "before:absolute before:top-4 before:right-1/2 before:w-full before:-translate-y-1/2 before:border-t-2",
                  i > 0 && (i <= index ? "before:border-primary" : "before:border-line-strong"),
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    // Узкий экран и шрифт 200 %: кружок не шире своей колонки (квадрат по ширине), а не 2rem насильно.
                    "relative z-10 inline-flex aspect-square w-8 max-w-full items-center justify-center rounded-full text-sm leading-none font-bold tabular-nums",
                    done && "bg-primary text-on-primary",
                    active && "bg-primary text-on-primary ring-4 ring-accent-soft",
                    !done && !active && "border-2 border-line-strong bg-surface text-muted",
                  )}
                >
                  {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                </span>
                {/* Для диктора — одна строка «Стиль: пройден»: из соседних элементов браузер собрал бы «Стиль : пройден». */}
                <span aria-hidden className={cn("hidden max-w-full text-center leading-tight break-words hyphens-auto", labelsFrom, active ? "font-bold text-ink" : "text-muted")}>
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
