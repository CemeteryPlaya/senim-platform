import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { List, ListItem, ListRow } from "./List";

export type HelpBlockProps = {
  items: { question: string; href: string }[];
  supportEmail: string;
};

/**
 * «Помощь» под содержимым главной и сделки: частые вопросы и связь с поддержкой. Заголовок — первая строка карточки
 * (17 px / 600, как блок 6 в docs/design/v3/reference/hints.html): верх карточки совпадает с верхом соседней колонки.
 */
export function HelpBlock({ items, supportEmail }: HelpBlockProps) {
  const t = ru.app.kit.help;
  return (
    <Card as="section" padded={false}>
      <h2 className="px-4 pt-4 text-headline text-ink">{t.title}</h2>
      <List>
        {items.map((item, index) => (
          <ListRow key={`${index}-${item.href}`} label={item.question} href={item.href} />
        ))}
        {/* Внешнее действие (почтовая программа): обычная ссылка без шеврона. */}
        <ListItem>
          <a
            href={`mailto:${encodeURI(supportEmail)}`}
            className="flex min-h-control w-full items-center px-4 py-3 text-body font-medium text-accent no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
          >
            {t.contact}
          </a>
        </ListItem>
      </List>
    </Card>
  );
}
