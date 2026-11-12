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
          {items.map((item) => (
            <ListRow key={item.href} label={item.question} href={item.href} />
          ))}
          <ListRow label={<span className="text-accent">{t.contact}</span>} href={`mailto:${supportEmail}`} />
        </List>
      </Card>
    </section>
  );
}
