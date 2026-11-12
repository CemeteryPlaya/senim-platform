import type { ButtonHTMLAttributes } from "react";

export type SegmentedOption = {
  value: string;
  label: string;
  /** Действие сервера для этого сегмента (кнопка отправки формы): работает и без JavaScript. */
  formAction: ButtonHTMLAttributes<HTMLButtonElement>["formAction"];
};

export type SegmentedProps = { legend: string; options: readonly SegmentedOption[]; value: string };

/**
 * Сегментированный переключатель: общая подложка `line`, равные сегменты в одну строку, выбранный — поверхность
 * `surface` и вес 600, без тени. Сегменты — кнопки отправки одной формы (форму даёт вызывающий) с aria-pressed.
 * Текст сегментов — ink: muted на подложке line ниже 4,5:1. Высота касания — 48 px на телефоне, 36 px на компьютере.
 * Сегменты без зазора и с узкими полями: «Как в системе» помещается в одну строку на телефоне шириной 360 px и больше.
 * Подпись длиннее сегмента (крупный системный шрифт) переносится внутри него, а не уводит сегменты на вторую строку.
 */
export function Segmented({ legend, options, value }: SegmentedProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sub font-medium text-ink">{legend}</legend>
      <div className="grid grid-flow-col auto-cols-fr rounded-control bg-line p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="submit"
            aria-pressed={option.value === value}
            formAction={option.formAction}
            className="flex min-h-control-sm min-w-0 items-center justify-center rounded-field px-1 text-center text-sub font-medium text-ink transition-transform duration-100 active:scale-press aria-pressed:bg-surface aria-pressed:font-semibold mobile:min-h-control"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
