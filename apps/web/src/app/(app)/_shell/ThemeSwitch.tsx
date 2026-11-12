import { ru } from "@/i18n/ru";
import { Button } from "@/kit";
import type { Theme } from "@/kit/theme";
import { setTheme } from "./theme-actions";

const t = ru.app.shell.theme;

const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: "system", label: t.system },
  { value: "light", label: t.light },
  { value: "dark", label: t.dark },
];

/**
 * Переключатель темы: три кнопки отправки одной формы, у каждой — своё действие сервера с темой (bind). Работает и без
 * JavaScript: форма отправляется обычным запросом, сервер пишет куку и отдаёт страницу уже в новой теме. Выбранная
 * кнопка — `secondary` с aria-pressed="true", остальные — `quiet`; главной кнопки здесь нет (она принадлежит экрану).
 */
export function ThemeSwitch({ current }: { current: Theme }) {
  return (
    <form>
      <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 text-sub font-medium text-ink">{t.legend}</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              type="submit"
              variant={value === current ? "secondary" : "quiet"}
              aria-pressed={value === current}
              formAction={setTheme.bind(null, value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
