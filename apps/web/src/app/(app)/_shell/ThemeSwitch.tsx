import { ru } from "@/i18n/ru";
import { Segmented } from "@/kit";
import type { Theme } from "@/kit/theme";
import { setTheme } from "./theme-actions";

const t = ru.app.shell.theme;

/**
 * Переключатель темы: сегментированный переключатель из трёх кнопок отправки одной формы, у каждой — своё действие
 * сервера с темой (bind). Работает и без JavaScript: форма отправляется обычным запросом, сервер пишет куку и отдаёт
 * страницу уже в новой теме. Выбранный сегмент — aria-pressed="true"; главной кнопки здесь нет (она принадлежит экрану).
 */
export function ThemeSwitch({ current }: { current: Theme }) {
  return (
    <form>
      <Segmented
        legend={t.legend}
        value={current}
        options={[
          { value: "system", label: t.system, formAction: setTheme.bind(null, "system") },
          { value: "light", label: t.light, formAction: setTheme.bind(null, "light") },
          { value: "dark", label: t.dark, formAction: setTheme.bind(null, "dark") },
        ]}
      />
    </form>
  );
}
