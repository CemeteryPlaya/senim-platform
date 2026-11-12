import type { ReactNode } from "react";
import { BackLink, type BackLinkProps } from "./BackLink";

export type PageTitleProps = {
  title: string;
  /** Вложенный экран: видимая ссылка на родителя над заголовком. */
  back?: BackLinkProps;
  lead?: ReactNode;
};

/** Заголовок экрана: единственный `<h1>`; размер 28 px на телефоне и 32 px на компьютере задаёт токен. */
export function PageTitle({ title, back, lead }: PageTitleProps) {
  return (
    <header className="flex flex-col gap-2">
      {back && <BackLink {...back} />}
      <h1 className="text-title text-ink">{title}</h1>
      {lead && <div className="text-body text-muted">{lead}</div>}
    </header>
  );
}
