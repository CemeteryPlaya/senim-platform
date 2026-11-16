"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ru } from "@/i18n/ru";
import { navMemory, shouldGoBack } from "./back-nav";
import { cn } from "./cn";

export type BackLinkProps = {
  href: string;
  label: string;
  /** На стекле (шапка переписки): цвет `glass-secondary` вместо muted — muted на стекле ниже 4,5:1. */
  onGlass?: boolean;
};

/**
 * «Назад» — один вид везде (PageTitle, WizardHeader): шеврон «‹» и название родителя, 15 px, цвет muted (на стекле — glass-secondary; эталон
 * mobile.html, «‹ Сделки»). Диктор слышит «Назад: <родитель>». Цель касания — 48 px на телефоне, 36 px на компьютере.
 * Отрицательный отступ слева выравнивает сам шеврон (у иконки поле внутри квадрата) по левому краю содержимого.
 *
 * Шаг назад по истории: если человек пришёл с экрана-родителя этого сайта (оболочка помнит путь — NavHistory), нажатие делает
 * `history.back()` — прокрутка списка и фильтры в адресе на месте, история не растёт. При прямом входе (уведомление, ссылка)
 * — обычный переход к родителю. Остаётся настоящей ссылкой: средняя кнопка, Ctrl/⌘ и «открыть в новой вкладке» работают.
 * Клиентский компонент.
 */
export function BackLink({ href, label, onGlass = false }: BackLinkProps) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        const goBack = shouldGoBack({
          memory: navMemory.read(),
          href,
          click: { button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented },
          historyLength: window.history.length,
        });
        if (!goBack) return;
        event.preventDefault();
        window.history.back();
      }}
      className={cn(
        "-ml-2 inline-flex min-h-control w-fit items-center gap-1 text-sub no-underline hover:text-ink desktop:min-h-control-sm",
        onGlass ? "text-glass-secondary" : "text-muted",
      )}
    >
      <ChevronLeft aria-hidden className="size-5 shrink-0" />
      <span className="sr-only">{`${ru.app.kit.back}: `}</span>
      {label}
    </Link>
  );
}
