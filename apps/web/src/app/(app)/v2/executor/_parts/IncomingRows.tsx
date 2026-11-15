import { Card, List, ListRow, StatusChip } from "@/kit";
import type { IncomingCardView } from "./incoming-view";

/**
 * Список входящих заявок мастера: строка — ссылка на заявку. Название (что нужно), метки («Новая», «Прямая заявка вам»,
 * моё предложение), под ними — город, сегмент, срок, когда опубликована. Общий для экрана «Заявки» и главной.
 */
export function IncomingRows({ cards }: { cards: readonly IncomingCardView[] }) {
  return (
    <Card padded={false}>
      <List>
        {cards.map((card) => (
          <ListRow
            key={card.id}
            href={card.href}
            label={
              // Метки и сведения под названием, а не справа: на телефоне справа они сжимали бы строку.
              <span className="flex flex-col items-start gap-1">
                <span className="text-headline wrap-break-word text-ink">{card.title}</span>
                {card.badges.length > 0 && (
                  <span className="flex flex-wrap gap-2">
                    {card.badges.map((b) => (
                      <StatusChip key={b.text} tone={b.tone}>
                        {b.text}
                      </StatusChip>
                    ))}
                  </span>
                )}
                <span className="text-sub text-muted">{card.meta.join(" · ")}</span>
              </span>
            }
          />
        ))}
      </List>
    </Card>
  );
}
