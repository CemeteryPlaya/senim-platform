import { ru } from "@/i18n/ru";
import { Segmented } from "@/kit";
import type { Theme } from "@/kit/theme";
import { chooseTheme } from "./theme-actions";

const t = ru.app.shell.theme;

/**
 * Переключатель темы: сегментированный переключатель из трёх кнопок отправки одной формы, у каждой — своё действие
 * сервера с темой (bind). Форма серверная, но без JavaScript отправка сейчас отклоняется из-за заголовка
 * `Referrer-Policy: no-referrer` (решение владельца, см. спеку, раздел 14); с JavaScript сервер пишет куку и
 * перерисовывает страницу в новой теме. Выбранный сегмент — aria-pressed="true"; главной кнопки здесь нет (она
 * принадлежит экрану). `legend` — подпись группы (по умолчанию «Оформление»; под одноимённым заголовком раздела — своя).
 * `legendHidden` — подпись только для диктора: когда группу уже называет заголовок раздела.
 */
export function ThemeSwitch({ current, legend = t.legend, legendHidden = false }: { current: Theme; legend?: string; legendHidden?: boolean }) {
  return (
    <form>
      <Segmented
        legend={legend}
        legendHidden={legendHidden}
        value={current}
        options={[
          { value: "system", label: t.system, formAction: chooseTheme.bind(null, "system") },
          { value: "light", label: t.light, formAction: chooseTheme.bind(null, "light") },
          { value: "dark", label: t.dark, formAction: chooseTheme.bind(null, "dark") },
        ]}
      />
    </form>
  );
}
