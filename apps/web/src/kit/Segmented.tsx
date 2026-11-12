import type { ButtonHTMLAttributes } from "react";

export type SegmentedOption = {
  value: string;
  label: string;
  /** Действие сервера для этого сегмента (кнопка отправки формы): работает и без JavaScript. */
  formAction: ButtonHTMLAttributes<HTMLButtonElement>["formAction"];
};

export type SegmentedProps = { legend: string; options: readonly SegmentedOption[]; value: string };

/**
 * Сегментированный переключатель: дорожка `track`, равные сегменты в одну строку, выбранный — поверхность `raised`
 * и вес 600, без тени. `raised` светлее `track` в обеих темах (contrast.test.ts): в светлой — белый сегмент на серой
 * дорожке, в тёмной — #2c2c2e на #1c1c1e, сегмент приподнят, а не утоплен. Текст сегментов — ink.
 * Сегменты — кнопки отправки одной формы (форму даёт вызывающий) с aria-pressed. Высота касания — 48 px, на
 * компьютере 36 px. Подписи короткие; подпись длиннее сегмента (крупный шрифт) переносится внутри него, а не уводит
 * сегменты на вторую строку.
 */
export function Segmented({ legend, options, value }: SegmentedProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sub font-medium text-ink">{legend}</legend>
      <div className="grid grid-flow-col auto-cols-fr rounded-control bg-track p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="submit"
            aria-pressed={option.value === value}
            formAction={option.formAction}
            className="flex min-h-control min-w-0 items-center justify-center rounded-field px-2 text-center text-sub font-medium text-ink transition-transform duration-100 active:scale-press aria-pressed:bg-raised aria-pressed:font-semibold desktop:min-h-control-sm"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
