import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export type PageTitleProps = {
  title: string;
  /** Вложенный экран: видимая ссылка на родителя над заголовком. */
  back?: { href: string; label: string };
  lead?: ReactNode;
};

/** Заголовок экрана: единственный `<h1>`; размер 28 px на телефоне и 32 px на компьютере задаёт токен. */
export function PageTitle({ title, back, lead }: PageTitleProps) {
  return (
    <header className="flex flex-col gap-2">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-control w-fit items-center gap-1 text-body font-medium text-accent no-underline"
        >
          <ChevronLeft aria-hidden className="size-5" />
          {back.label}
        </Link>
      )}
      <h1 className="text-title text-ink">{title}</h1>
      {lead && <div className="text-body text-muted">{lead}</div>}
    </header>
  );
}
