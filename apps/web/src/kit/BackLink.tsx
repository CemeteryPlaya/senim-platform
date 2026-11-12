import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ru } from "@/i18n/ru";

export type BackLinkProps = { href: string; label: string };

/**
 * «Назад» — один вид везде (PageTitle, WizardHeader): шеврон «‹» и название родителя, 15 px, цвет muted (эталон
 * mobile.html, «‹ Сделки»). Диктор слышит «Назад: <родитель>». Цель касания — 48 px на телефоне, 36 px на компьютере.
 * Отрицательный отступ слева выравнивает сам шеврон (у иконки поле внутри квадрата) по левому краю содержимого.
 */
export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex min-h-control-sm w-fit items-center gap-1 text-sub text-muted no-underline hover:text-ink mobile:min-h-control"
    >
      <ChevronLeft aria-hidden className="size-5 shrink-0" />
      <span className="sr-only">{`${ru.app.kit.back}: `}</span>
      {label}
    </Link>
  );
}
