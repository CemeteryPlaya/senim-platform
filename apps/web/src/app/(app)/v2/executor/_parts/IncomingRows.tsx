import { Card, List, ListRow, StatusChip } from "@/kit";
import { thumbOf } from "../../_parts/Thumb";
import type { IncomingCardView } from "./incoming-view";

/**
 * Список входящих заявок мастера (сгруппированный список): строка — ссылка на заявку. Миниатюра 56 px (первое фото
 * помещения), название (что нужно), метки («Новая», «Прямая заявка вам», моё предложение), под ними — город, сегмент,
 * срок (короткой датой), когда опубликована. Общий для экрана «Заявки» и главной.
 */
export function IncomingRows({ cards }: { cards: readonly IncomingCardView[] }) {
  return (
    <Card variant="grouped">
      <List>
        {cards.map((card) => (
          <ListRow
            key={card.id}
            href={card.href}
            leading={thumbOf(card.cover)}
            label={
              // Метки и сведения под названием, а не справа: на телефоне справа они сжимали бы строку.
              <span className="flex flex-col items-start gap-1 py-1">
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
                {/* Сведения — две строки: где и к какому сроку; когда опубликована и сколько предложений. Перенос — только
                    между частями (« · »), часть не рвётся: «Нужно к 5 дек» целиком. */}
                <span className="flex flex-col text-sub text-muted">
                  {card.lines
                    .filter((parts) => parts.length > 0)
                    .map((parts) => (
                      <span key={parts.join()} className="flex flex-wrap gap-x-1">
                        {parts.map((part, index) => (
                          <span key={part} className="whitespace-nowrap">
                            {index > 0 && "· "}
                            {part}
                          </span>
                        ))}
                      </span>
                    ))}
                </span>
              </span>
            }
          />
        ))}
      </List>
    </Card>
  );
}
