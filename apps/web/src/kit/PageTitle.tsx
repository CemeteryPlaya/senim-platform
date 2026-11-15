import type { ReactNode } from "react";
import { BackLink, type BackLinkProps } from "./BackLink";
import { cn } from "./cn";

export type PageTitleProps = {
  title: string;
  /** Вложенный экран: видимая ссылка на родителя над заголовком. */
  back?: BackLinkProps;
  lead?: ReactNode;
  /**
   * Заголовок лежит на стекле (закреплённая шапка переписки, `glass-bar`): вторичный текст — `glass-secondary`, а не
   * muted (muted и accent на стекле не держат 4,5:1, contrast.test.ts). Пояснения в `lead` передавайте тоже с `onGlass`.
   */
  onGlass?: boolean;
};

/**
 * Заголовок экрана: единственный `<h1>`, без висящих слов в конце строк (text-balance); размер 34 px на телефоне и 40 px
 * на компьютере задаёт токен `text-title`.
 */
export function PageTitle({ title, back, lead, onGlass = false }: PageTitleProps) {
  return (
    <header className="flex flex-col gap-2">
      {back && <BackLink {...back} onGlass={onGlass} />}
      <h1 className="text-balance wrap-break-word text-title text-ink">{title}</h1>
      {lead && <div className={cn("text-body", onGlass ? "text-glass-secondary" : "text-muted")}>{lead}</div>}
    </header>
  );
}
