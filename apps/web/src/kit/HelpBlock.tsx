import { ru } from "@/i18n/ru";
import { Card } from "./Card";
import { List, ListRow } from "./List";

export type HelpBlockProps = {
  items: { question: string; href: string }[];
  supportEmail: string;
};

/** «Помощь» под содержимым главной и сделки: частые вопросы и связь с поддержкой. */
export function HelpBlock({ items, supportEmail }: HelpBlockProps) {
  const t = ru.app.kit.help;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-section text-ink">{t.title}</h2>
      <Card padded={false}>
        <List>
          {items.map((item, index) => (
            <ListRow key={`${index}-${item.href}`} label={item.question} href={item.href} />
          ))}
          {/* Внешнее действие (почтовая программа): обычная ссылка без шеврона. */}
          <li>
            <a
              href={`mailto:${encodeURI(supportEmail)}`}
              className="flex min-h-control w-full items-center px-4 py-3 text-body font-medium text-accent no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
            >
              {t.contact}
            </a>
          </li>
        </List>
      </Card>
    </section>
  );
}
