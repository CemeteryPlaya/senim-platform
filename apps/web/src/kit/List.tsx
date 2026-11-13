import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/** Строка списка — элемент (`ListRow` или `ListItem`), в том числе из map и по условию; текста напрямую нет. */
type ListChild = ReactElement | false | null | undefined;

/**
 * Список строк. Кладётся внутрь `Card` (обычно `padded={false}`). Строки — только `ListRow` или `ListItem`: разделитель
 * с отступом 16 px рисует `ListItem`, у голого `<li>` его не было бы.
 */
export function List({ children, className }: { children: ListChild | readonly (ListChild | readonly ListChild[])[]; className?: string }) {
  return <ul className={className}>{children}</ul>;
}

/**
 * Строка списка с разделителем снизу: линия `line` с отступом 16 px слева, как в эталонах; у последней строки
 * разделителя нет. Для строк со своей разметкой (например, ссылка на почту в HelpBlock).
 */
export function ListItem({ children }: { children: ReactNode }) {
  return (
    <li className="relative after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:border-b after:border-line last:after:hidden">
      {children}
    </li>
  );
}

export type ListRowProps = {
  label: ReactNode;
  value?: ReactNode;
  /** Есть адрес — вся строка ссылка, справа шеврон. */
  href?: string;
  /** Шеврон у строки-ссылки (по умолчанию да); `false` — для якорей на этой же странице: переход, а не вход вглубь. */
  chevron?: boolean;
  /** Подпись над значением (для длинных значений: адрес, описание); значение переносится. */
  stacked?: boolean;
};

const rowClass = "flex min-h-control w-full items-center justify-between gap-4 px-4 py-3 text-body";

/** Строка «подпись — значение». Значение — muted; сумма (`Money`) задаёт свой цвет ink сама. */
export function ListRow({ label, value, href, chevron = true, stacked = false }: ListRowProps) {
  const arrow = href && chevron && <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />;
  const content = stacked ? (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sub text-muted">{label}</span>
        {value !== undefined && <span className="text-body wrap-break-word text-ink">{value}</span>}
      </span>
      {arrow}
    </>
  ) : (
    <>
      {/* Подпись muted, значение ink; строка без значения (ссылка) — подпись и есть содержимое, поэтому ink. */}
      <span className={cn("min-w-0", value !== undefined ? "text-muted" : "text-ink")}>{label}</span>
      {(value !== undefined || arrow) && (
        <span className="flex shrink-0 items-center gap-1 text-ink">
          {value !== undefined && <span>{value}</span>}
          {arrow}
        </span>
      )}
    </>
  );
  return (
    <ListItem>
      {href ? (
        <Link href={href} className={cn(rowClass, "no-underline transition-colors duration-100 hover:bg-canvas active:bg-line")}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </ListItem>
  );
}
