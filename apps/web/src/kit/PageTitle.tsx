import type { ReactNode } from "react";
import { BackLink, type BackLinkProps } from "./BackLink";
import { cn } from "./cn";
import { TitleAction } from "./TitleAction";

export type PageTitleProps = {
  title: string;
  /** Вложенный экран: видимая ссылка на родителя над заголовком. */
  back?: BackLinkProps;
  lead?: ReactNode;
  /** Знак слева от заголовка (монограмма мастера): стоит рядом только с `<h1>`, «Назад» и `lead` остаются отдельными строками. */
  leading?: ReactNode;
  /**
   * Круглые кнопки справа в строке заголовка («…» — `Menu`): стоят у первой строки `<h1>`, а не отдельной строкой над ним.
   * Строка заголовка в покое не плавает — кнопки без стекла. Не помещаются рядом с самым длинным словом заголовка
   * (крупный шрифт) — уходят под заголовок, к правому краю; заголовок переносится по словам.
   */
  trailing?: ReactNode;
  /**
   * Заголовок лежит на стекле (закреплённая шапка переписки, `glass-bar`): вторичный текст — `glass-secondary`, а не
   * muted (muted и accent на стекле не держат 4,5:1, contrast.test.ts). Пояснения в `lead` передавайте тоже с `onGlass`.
   */
  onGlass?: boolean;
};

/**
 * Кнопки строки заголовка: круг 48 px против строки `<h1>` 34 px × 1,1 — поля −6 px сверху и снизу ставят круг по центру
 * первой строки и не раздвигают её. В переносе — к правому краю.
 */
const ACTIONS = "-my-1.5 ml-auto flex shrink-0 items-center gap-1";

/**
 * Заголовок экрана: единственный `<h1>`, без висящих слов в конце строк (text-balance); размер 34 px на телефоне и 40 px
 * на компьютере задаёт токен `text-title`. Справа в строке заголовка — свои кнопки (`trailing`) и действие оболочки
 * (`TitleAction`: колокольчик на корневых экранах вкладок телефона). Заголовок не уже самого длинного слова (кроме слова
 * шире экрана — оно переносится): кнопки скорее уйдут под заголовок, чем разорвут слово.
 */
export function PageTitle({ title, back, lead, leading, trailing, onGlass = false }: PageTitleProps) {
  const actions = (
    <>
      {trailing && <div className={ACTIONS}>{trailing}</div>}
      <TitleAction className={ACTIONS} />
    </>
  );
  return (
    <header className="flex flex-col gap-2">
      {back && <BackLink {...back} onGlass={onGlass} />}
      {leading ? (
        <div className="flex items-center gap-4">
          {leading}
          <h1 className="min-w-0 flex-1 text-balance wrap-break-word text-title text-ink">{title}</h1>
          {actions}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h1 className="max-w-full flex-1 text-balance wrap-break-word text-title text-ink">{title}</h1>
          {actions}
        </div>
      )}
      {lead && <div className={cn("text-body", onGlass ? "text-glass-secondary" : "text-muted")}>{lead}</div>}
    </header>
  );
}
