import { ButtonLink } from "./Button";
import { Card } from "./Card";

export type EmptyStateProps = {
  title: string;
  body: string;
  /** Единственное главное действие экрана; без него кнопки нет. */
  action?: { href: string; label: string };
};

/**
 * Обучающий пустой экран: что здесь будет и что сделать первым. Текст по центру и не шире 560 px — карточка может
 * стоять во всю ширину сетки компьютера, а строки не растягиваются.
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <Card as="section" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <h2 className="text-headline text-ink">{title}</h2>
      <p className="mx-auto max-w-narrow text-body text-muted">{body}</p>
      {action && (
        <ButtonLink href={action.href} className="mt-4">
          {action.label}
        </ButtonLink>
      )}
    </Card>
  );
}
