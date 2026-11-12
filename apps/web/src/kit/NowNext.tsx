import { ru } from "@/i18n/ru";
import { Card } from "./Card";

export type NowNextProps = {
  now: { title: string; body?: string };
  /** Что будет после: одна короткая строка. */
  next?: string;
};

/**
 * «Что сейчас происходит»: первая карточка сделки и заявки. Обычная разметка без role="status":
 * блок есть на странице с загрузки, а живая область объявляла бы его при каждой подстановке данных.
 */
export function NowNext({ now, next }: NowNextProps) {
  return (
    <div className="flex flex-col gap-2">
      <Card as="section">
        <p className="text-small text-muted">{ru.app.kit.nowNext.now}</p>
        <p className="mt-1 text-card text-ink">{now.title}</p>
        {now.body && <p className="mt-1 text-sub text-muted">{now.body}</p>}
      </Card>
      {next && (
        <p className="px-1 text-sub text-muted">
          <span className="font-medium text-ink">{ru.app.kit.nowNext.next}</span>
          {": "}
          {next}
        </p>
      )}
    </div>
  );
}
