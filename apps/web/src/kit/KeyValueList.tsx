import type { ReactNode } from "react";

export type KeyValueItem = {
  /** Подпись («Исполнитель», «ИИН/БИН»). */
  label: string;
  /** Значение: текст, `<Money>`, `StatusChip`, ссылка. Длинное переносится по словам. */
  value: ReactNode;
};

export type KeyValueListProps = { items: readonly KeyValueItem[] };

/**
 * Список «подпись — значение» для карточек оператора (реквизиты исполнителя, сделка, настройки): разметка `dl` — диктор
 * связывает подпись со значением. Кладётся в `Card padded={false}` (как `List`); строки через тонкую линию, поля 16 px.
 *
 * Компьютер: подписи в левой колонке до 14 rem (вторичный текст 17 px), значения — справа на остальную ширину; при
 * крупном шрифте колонка подписей сжимается, а не выталкивает значение за край. Телефон: подпись 15 px над значением 17 px
 * (длинный адрес или название не делит строку с подписью). Для строк-ссылок со стрелкой — `ListRow`. Серверный компонент.
 */
export function KeyValueList({ items }: KeyValueListProps) {
  return (
    <dl className="m-0">
      {items.map((item, index) => (
        <div
          key={`${index}-${item.label}`}
          className="flex flex-col gap-1 border-t border-line px-card py-3 first:border-t-0 desktop:grid desktop:grid-cols-key-value desktop:gap-4"
        >
          <dt className="text-sub text-muted wrap-break-word desktop:text-body">{item.label}</dt>
          <dd className="m-0 min-w-0 text-body text-ink wrap-break-word">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
