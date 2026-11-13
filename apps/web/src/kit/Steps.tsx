import { Check } from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type StepState = "done" | "current" | "todo";

export type StepsProps = {
  /** Шаги по порядку; у каждого своё состояние (какие пройдены, какой идёт, какие впереди). */
  items: readonly { label: string; state: StepState }[];
  /** Пояснение к текущему шагу: на телефоне под ним, на компьютере под шкалой. */
  note?: string;
  /** Остановлено (спор, отмена): вместо шкалы нейтральная плашка с этим текстом. */
  stopped?: { label: string };
  /** Имя списка для диктора («Ход сделки»). */
  label?: string;
};

/** Отметка шага: галочка `accent` у пройденного, заполненная точка `ink` у текущего, пустая у будущих. Без цветных кружков. */
function Marker({ state }: { state: StepState }) {
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
      {state === "done" && <Check className="size-5 text-accent" />}
      {state === "current" && <span className="size-3 rounded-full bg-ink" />}
      {state === "todo" && <span className="size-3 rounded-full border-2 border-line-strong" />}
    </span>
  );
}

/**
 * Ход сделки: пять-шесть шагов. Телефон — вертикальный список (подпись справа от отметки), компьютер — горизонтальная
 * шкала (подписи под отметками); версию выбирают варианты `desktop:` / `mobile:`, разметка одна. Семантика — `<ol>`,
 * текущий шаг `aria-current="step"`. Серверный компонент.
 */
export function Steps({ items, note, stopped, label }: StepsProps) {
  if (stopped) {
    return (
      <p role="status" className="rounded-card bg-canvas p-4 text-body text-ink">
        {stopped.label}
      </p>
    );
  }
  const last = items.length - 1;
  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={label} className="flex mobile:flex-col desktop:flex-row">
        {items.map((item, index) => {
          const isLast = index === last;
          return (
            <li
              key={`${index}-${item.label}`}
              aria-current={item.state === "current" ? "step" : undefined}
              className="flex min-w-0 mobile:flex-row mobile:gap-3 desktop:flex-1 desktop:flex-col desktop:gap-2"
            >
              {/* Отметка и линия к следующему шагу: на телефоне колонка, на компьютере ряд. */}
              <span aria-hidden className="flex shrink-0 items-center mobile:flex-col desktop:flex-row">
                <Marker state={item.state} />
                {!isLast && (
                  <span
                    className={cn(
                      "mobile:min-h-6 mobile:w-px mobile:flex-1 desktop:h-px desktop:min-w-6 desktop:flex-1",
                      item.state === "done" ? "bg-accent" : "bg-line",
                    )}
                  />
                )}
              </span>
              <span className={cn("flex min-w-0 flex-col gap-1", !isLast && "mobile:pb-4")}>
                <span
                  className={cn(
                    "text-body wrap-break-word desktop:text-sub",
                    item.state === "current" ? "font-semibold text-ink" : "text-muted",
                  )}
                >
                  {item.label}
                  {item.state === "done" && <span className="sr-only">{`, ${ru.app.kit.steps.done.toLowerCase()}`}</span>}
                </span>
                {item.state === "current" && note && <span className="text-sub text-muted desktop:hidden">{note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {note && <p className="text-sub text-muted mobile:hidden">{note}</p>}
    </div>
  );
}
