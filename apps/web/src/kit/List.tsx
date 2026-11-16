import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import { HiddenField } from "./HiddenField";
import { RowChevron } from "./RowChevron";

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
 * Строка списка с разделителем снизу: линия `line` с отступом 16 px слева, как в «Настройках»; у последней строки
 * разделителя нет. Для строк со своей разметкой (например, ссылка на почту в HelpBlock). `inset="none"` — разделитель
 * рисует сама строка (ListRow с `leading`: линия от начала текста, какой бы ширины ни была миниатюра или монограмма).
 */
export function ListItem({ children, inset = "text" }: { children: ReactNode; inset?: "text" | "none" }) {
  return (
    <li
      className={cn(
        "group/row relative",
        inset === "text" && "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-card after:border-b after:border-line last:after:hidden",
      )}
    >
      {children}
    </li>
  );
}

/**
 * Колонка текста строки с `leading`: тянется на высоту строки, а разделитель — её нижняя кромка, продлённая вниз на
 * поле строки (py-2) и вправо до края карточки (px-card). Начинается ровно там, где начинается текст.
 */
const TEXT_COLUMN =
  "relative flex min-w-0 flex-1 items-center justify-between gap-4 self-stretch after:pointer-events-none after:absolute after:-right-card after:-bottom-2 after:left-0 after:border-b after:border-line group-last/row:after:hidden";

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

/** Поля строки по бокам — как у карточки, 16 px в px (`px-card`): при шрифте 200 % растёт текст, а не поля. */
const ROW = "flex min-h-control w-full items-center justify-between px-card text-body";

/**
 * Строка «подпись — значение» (разбор 3.6, «Списки»): [миниатюра или монограмма] + подпись + вторая строка + справа
 * значение и шеврон 16 px muted. Значение — muted; сумма (`Money`) задаёт свой цвет ink сама.
 */
export function ListRow({ label, value, href, chevron = true, stacked = false, action, fields, leading, detail }: ListRowProps) {
  // Шеврон строки-ссылки сменяется индикатором, пока идёт переход по ней (RowChevron, useLinkStatus).
  const arrow = href && chevron && <RowChevron />;
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
      <span className="ml-auto flex shrink-0 items-center gap-1 text-ink">
        {value !== undefined && <span>{value}</span>}
        {arrow}
      </span>
    );
  }
  const content =
    leading === undefined ? (
      <>
        {labelPart}
        {valuePart}
      </>
    ) : (
      <>
        <span className="flex shrink-0">{leading}</span>
        <span data-row-text className={TEXT_COLUMN}>
          {labelPart}
          {valuePart}
        </span>
      </>
    );
  const inset = leading === undefined ? "text" : "none";
  // С leading: строка 56 px, зазор миниатюра — текст 12 px; без неё — зазор подпись — значение 16 px. Строка со значением
  // без leading переносится: если подпись и значение не помещаются в строку (шрифт 200 %, длинный телефон), значение
  // целиком уходит на следующую строку вправо, а не за край экрана — подпись не рвётся (разбор 2, 3.4 и 3.7). Строку с
  // одним шевроном не переносим: шеврон остаётся справа от подписи.
  const wraps = leading === undefined && !stacked && value !== undefined;
  const rowClass = cn(ROW, leading !== undefined ? "min-h-14 gap-3 py-2" : wraps ? "flex-wrap gap-x-4 gap-y-1 py-3" : "gap-4 py-3");
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
