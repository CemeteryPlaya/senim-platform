import { ru } from "@/i18n/ru";
import { Card } from "./Card";

export type NowNextProps = {
  now: { title: string; body?: string };
  /** Что будет после: одна короткая строка. */
  next?: string;
};

/**
 * «Что сейчас происходит»: первая карточка сделки и заявки. «Дальше» — в той же карточке под разделителем: мелкая
 * серая подпись, как у «Сейчас», и строка обычным весом. Обычная разметка без role="status": блок есть на странице
 * с загрузки, а живая область объявляла бы его при каждой подстановке данных.
 */
export function NowNext({ now, next }: NowNextProps) {
  const t = ru.app.kit.nowNext;
  return (
    <Card as="section">
      <p className="text-small text-muted">{t.now}</p>
      <h2 className="mt-1 text-headline text-ink">{now.title}</h2>
      {now.body && <p className="mt-1 text-sub text-muted">{now.body}</p>}
      {next && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-small text-muted">{t.next}</p>
          <p className="mt-1 text-body text-ink">{next}</p>
        </div>
      )}
    </Card>
  );
}
