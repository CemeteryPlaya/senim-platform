import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type TextLinkProps = { href: string; children: ReactNode };

/**
 * Тихая навигационная ссылка в потоке: «Я мастер», «Как это работает». Цвет `ink`, вес 500, после текста шеврон 16 px;
 * цель касания 48 px по высоте. Текст стоит ровно по левой линии содержимого: боковых отступов и отрицательных полей
 * нет (в отличие от тихой кнопки, у которой текст сдвинут отступом 24 px). Наведение — подчёркивание, фокус — общее
 * кольцо. Не главное действие экрана: для него — `ButtonLink`. Серверный компонент.
 */
export function TextLink({ href, children }: TextLinkProps) {
  return (
    <Link href={href} className="inline-flex min-h-control w-fit items-center gap-1 text-body font-medium text-ink no-underline hover:underline">
      {children}
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}
