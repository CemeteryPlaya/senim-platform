import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";

export type TextLinkProps = {
  href: string;
  children: ReactNode;
  /**
   * Файл или чужая страница в новой вкладке (PDF — обработчик маршрута, а не экран): обычная ссылка без перехода и
   * предзагрузки роутера, `target="_blank"` и `rel="noopener noreferrer"`; вместо шеврона — значок внешней ссылки, для
   * диктора после подписи — «откроется в новой вкладке».
   */
  external?: boolean;
};

const CLASS = "inline-flex min-h-control w-fit items-center gap-1 text-body font-medium text-ink no-underline hover:underline";

/**
 * Тихая навигационная ссылка в потоке: «Я мастер», «Как это работает». Цвет `ink`, вес 500, после текста шеврон 16 px
 * (у внешней ссылки — значок внешней ссылки); цель касания 48 px по высоте. Текст стоит ровно по левой линии содержимого:
 * боковых отступов и отрицательных полей нет (в отличие от тихой кнопки, у которой текст сдвинут отступом 24 px).
 * Наведение — подчёркивание, фокус — общее кольцо. Не главное действие экрана: для него — `ButtonLink`. Серверный компонент.
 */
export function TextLink({ href, children, external = false }: TextLinkProps) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={CLASS}>
        {children}
        <span className="sr-only"> ({ru.app.kit.externalHint})</span>
        <ExternalLink aria-hidden className="size-4 shrink-0" />
      </a>
    );
  }
  return (
    <Link href={href} className={CLASS}>
      {children}
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </Link>
  );
}
