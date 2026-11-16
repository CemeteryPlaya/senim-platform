import { ButtonLink } from "./Button";
import { Card } from "./Card";

export type EmptyStateProps = {
  title: string;
  body: string;
  /** Единственное главное действие экрана; без него кнопки нет. */
  action?: { href: string; label: string };
  /**
   * id заголовка: на него можно перевести фокус программно (`tabIndex=-1`) — очередь решений (`DecisionQueue`) ставит его
   * сюда, когда решена последняя карточка. Без id заголовок обычный.
   */
  titleId?: string;
};

/**
 * Обучающий пустой экран: что здесь будет и что сделать первым. Текст по центру и не шире 560 px — карточка может
 * стоять во всю ширину сетки компьютера, а строки не растягиваются.
 */
export function EmptyState({ title, body, action, titleId }: EmptyStateProps) {
  return (
    <Card as="section" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <h2 id={titleId} tabIndex={titleId ? -1 : undefined} className="text-headline text-ink">
        {title}
      </h2>
      <p className="mx-auto max-w-narrow text-body text-muted">{body}</p>
      {action && (
        <ButtonLink href={action.href} className="mt-4">
          {action.label}
        </ButtonLink>
      )}
    </Card>
  );
}
