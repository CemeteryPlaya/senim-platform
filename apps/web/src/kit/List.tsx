import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Список строк с разделителем `line`. Кладётся внутрь `Card` (обычно `padded={false}`). */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-line", className)}>{children}</ul>;
}

export type ListRowProps = {
  label: ReactNode;
  value?: ReactNode;
  /** Есть адрес — вся строка ссылка, справа шеврон. */
  href?: string;
};

const rowClass = "flex min-h-control w-full items-center justify-between gap-4 px-4 py-3 text-body";

export function ListRow({ label, value, href }: ListRowProps) {
  const content = (
    <>
      <span className="min-w-0 text-ink">{label}</span>
      {(value !== undefined || href) && (
        <span className="flex shrink-0 items-center gap-1 text-muted">
          {value !== undefined && <span>{value}</span>}
          {href && <ChevronRight aria-hidden className="size-5" />}
        </span>
      )}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(rowClass, "no-underline transition-colors duration-100 hover:bg-canvas active:bg-line")}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
