import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { HiddenField } from "./HiddenField";

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
 * Строка списка с разделителем снизу: линия `line` с отступом слева до текста, как в «Настройках»: 16 px, а у строки с
 * миниатюрой или монограммой (`inset="leading"`) — от начала текста после неё (16 + 56 + 12 px). У последней строки
 * разделителя нет. Для строк со своей разметкой (например, ссылка на почту в HelpBlock).
 */
export function ListItem({ children, inset = "text" }: { children: ReactNode; inset?: "text" | "leading" }) {
  return (
    <li
      className={cn(
        "relative after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:border-b after:border-line last:after:hidden",
        inset === "leading" ? "after:left-21" : "after:left-4",
      )}
    >
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
  /**
   * Строка-действие: вместо ссылки — кнопка отправки формы с этим серверным действием (`<li><form action>`; без JS
   * работает как обычная форма). Вид и фокус те же, что у строки-ссылки; шеврона нет. Не сочетается с `href`.
   */
  action?: (formData: FormData) => void | Promise<void>;
  /** Скрытые поля формы строки-действия (например, `{ id }`). */
  fields?: Readonly<Record<string, string>>;
  /**
   * Слева от подписи: миниатюра 56 px (`photo-frame size-thumb rounded-thumb` с фото) или `Monogram size="md"`. Строка
   * тогда не ниже 56 px, а разделитель начинается от текста, а не от края.
   */
  leading?: ReactNode;
  /** Вторая строка под подписью (15 px, muted): «Шаг 2 из 5», «21 окт». Не больше двух строк. */
  detail?: ReactNode;
};

const ROW = "flex min-h-control w-full items-center justify-between gap-4 px-4 py-3 text-body";

/**
 * Строка «подпись — значение» (разбор 3.6, «Списки»): [миниатюра или монограмма] + подпись + вторая строка + справа
 * значение и шеврон 16 px muted. Значение — muted; сумма (`Money`) задаёт свой цвет ink сама.
 */
export function ListRow({ label, value, href, chevron = true, stacked = false, action, fields, leading, detail }: ListRowProps) {
  const arrow = href && chevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />;
  let labelPart: ReactNode;
  let valuePart: ReactNode;
  if (stacked) {
    labelPart = (
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sub text-muted">{label}</span>
        {value !== undefined && <span className="text-body wrap-break-word text-ink">{value}</span>}
      </span>
    );
    valuePart = arrow;
  } else {
    // Подпись muted, значение ink; строка без значения (ссылка) — подпись и есть содержимое, поэтому ink. Со второй
    // строкой (detail) подпись — заголовок строки: headline ink.
    labelPart =
      detail === undefined ? (
        <span className={cn("min-w-0", value !== undefined ? "text-muted" : "text-ink")}>{label}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="text-headline text-ink">{label}</span>
          <span className="line-clamp-2 text-sub text-muted">{detail}</span>
        </span>
      );
    valuePart = (value !== undefined || arrow) && (
      <span className="flex shrink-0 items-center gap-1 text-ink">
        {value !== undefined && <span>{value}</span>}
        {arrow}
      </span>
    );
  }
  const content = (
    <>
      {leading === undefined ? (
        labelPart
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex shrink-0">{leading}</span>
          {labelPart}
        </span>
      )}
      {valuePart}
    </>
  );
  const inset = leading === undefined ? "text" : "leading";
  const rowClass = cn(ROW, leading !== undefined && "min-h-14 py-2");
  if (action) {
    return (
      <ListItem inset={inset}>
        <form action={action}>
          {Object.entries(fields ?? {}).map(([name, fieldValue]) => (
            <HiddenField key={name} name={name} value={fieldValue} />
          ))}
          <button type="submit" className={cn(rowClass, "cursor-pointer text-left transition-colors duration-100 hover:bg-canvas active:bg-fill-strong")}>
            {content}
          </button>
        </form>
      </ListItem>
    );
  }
  return (
    <ListItem inset={inset}>
      {href ? (
        <Link href={href} className={cn(rowClass, "no-underline transition-colors duration-100 hover:bg-canvas active:bg-fill-strong")}>
          {content}
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </ListItem>
  );
}
