import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/ui";

export type ListCardProps = {
  title: ReactNode;
  /** Карточка целиком ведёт сюда: ссылка на заголовке, зона нажатия растянута на карточку. */
  href?: string;
  titleAs?: "h2" | "h3";
  /** Метки статуса (StatusBadge) под заголовком. */
  badges?: ReactNode;
  /** Строки подробностей, каждая — отдельной строкой. */
  meta?: readonly ReactNode[];
  /** Крупная строка внизу: сумма. */
  aside?: ReactNode;
  /** Формы и кнопки под карточкой — вне ссылки, нажимаются отдельно. */
  children?: ReactNode;
};

/**
 * Строка списка панели оператора в стиле карточек из макетов 12–17, но без фото: у исполнителей, споров
 * и заявок оператора фото нет, заглушка ничего бы не сказала. Списки — `<ul>` из таких карточек.
 */
export function ListCard({ title, href, titleAs: Title = "h3", badges, meta, aside, children }: ListCardProps) {
  const lines = meta?.filter((line) => line !== null && line !== undefined && line !== false && line !== "") ?? [];
  return (
    <li
      className={cn(
        "relative flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5",
        href && "transition-shadow duration-150 hover:shadow-raised has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Title className="min-w-0 text-lg leading-snug font-bold break-words text-ink">
            {href ? (
              <Link
                href={href}
                className="rounded-control text-ink no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </Title>
          {badges && <div className="flex flex-wrap gap-2">{badges}</div>}
          {lines.length > 0 && (
            <ul className="flex flex-col gap-1 text-base text-muted">
              {lines.map((line, i) => (
                <li key={i} className="min-w-0 break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {aside && <div className="text-lg font-bold text-ink">{aside}</div>}
        </div>
        {href && <ChevronRight aria-hidden className="size-6 shrink-0 self-center text-muted" />}
      </div>
      {children && <div className="relative z-10 flex flex-col gap-3">{children}</div>}
    </li>
  );
}

/** Сетка карточек: на телефоне — столбик, на широком экране — колонки; при шрифте 200 % снова столбик. */
export const LIST_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-4";
