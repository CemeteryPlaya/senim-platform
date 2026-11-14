import { Money } from "./Money";
import { TextLink } from "./TextLink";

export type TimelineItem = {
  title: string;
  /** Время события готовой строкой («10 ноября, 12:20»): формат выбирает экран. */
  time: string;
  text?: string;
  /** Сумма справа, в тиынах; показывается через `Money`. */
  amount?: bigint;
  /** Ссылка в строке под текстом («Открыть документ»): `external` — файл или страница в новой вкладке. */
  link?: { label: string; href: string; external?: boolean };
};

export type TimelineProps = {
  items: readonly TimelineItem[];
  /** Имя списка для диктора. */
  label?: string;
};

/**
 * Лента событий (история сделки, история денег): заголовок, время (вторичный текст), необязательные текст, ссылка и сумма
 * справа. Слева точка и линия к следующему событию. Семантика — `<ol>`. Серверный компонент.
 */
export function Timeline({ items, label }: TimelineProps) {
  const last = items.length - 1;
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item, index) => (
        <li key={`${index}-${item.title}`} className="flex gap-3">
          <span aria-hidden className="flex shrink-0 flex-col items-center">
            {/* Точка 8 px на уровне первой строки заголовка (строка ~25 px, отступ 8 px + половина точки = середина строки). */}
            <span className="mt-2 size-2 shrink-0 rounded-full bg-line-strong" />
            {index !== last && <span className="min-h-4 w-px flex-1 bg-line" />}
          </span>
          <div className={index !== last ? "flex min-w-0 flex-1 flex-col gap-1 pb-4" : "flex min-w-0 flex-1 flex-col gap-1"}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="min-w-0 text-body font-medium wrap-break-word text-ink">{item.title}</p>
              {item.amount !== undefined && (
                <span className="shrink-0 text-body">
                  <Money tiyn={item.amount} />
                </span>
              )}
            </div>
            <p className="text-sub text-muted">{item.time}</p>
            {item.text && <p className="text-sub wrap-break-word text-ink">{item.text}</p>}
            {item.link && (
              <TextLink href={item.link.href} external={item.link.external === true}>
                {item.link.label}
              </TextLink>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
