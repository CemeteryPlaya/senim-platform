"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { ru } from "@/i18n/ru";
import { shouldFollow } from "./chat-logic";
import { cn } from "./cn";

export type ChatAttachment = {
  id: string;
  name: string;
  /** Куда ведёт ссылка (полный размер). */
  url: string;
  /** Адрес превью; без него — ровная заглушка (фото ещё не загружено или превью нет). */
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  text: string;
  /** Время готовой строкой («10:05»). */
  time: string;
  /** Моё сообщение (справа на `accent-soft`); по умолчанию чужое (слева на `surface`). */
  mine?: boolean;
  /** `system` — служебная строка по центру вторичным текстом («Контакты скрыты до заключения оферты»). */
  kind?: "message" | "system";
  /** Имя автора для диктора; по умолчанию «Вы» / «Собеседник». */
  author?: string;
  attachments?: readonly ChatAttachment[];
};

export type ChatProps = {
  messages: readonly ChatMessage[];
  /** Поле ввода (`ChatComposer`) или любой узел; на телефоне прилипает к низу. */
  composer?: ReactNode;
  /** Имя ленты для диктора; по умолчанию «Переписка». */
  label?: string;
  /**
   * Прокручивать страницу, а не ленту. Включайте только на экране, где чат — всё содержимое (телефон: лента растёт в
   * потоке страницы, окно прокручивается к последнему сообщению). По умолчанию выключено: прокручивается сама лента
   * (на компьютере — окно высотой до 32 rem), а положение страницы не меняется.
   */
  pageScroll?: boolean;
  /**
   * Компьютер: лента занимает всю высоту родителя (`flex-1 min-h-0` со своей прокруткой) вместо окна высотой 32 rem.
   * Родитель — колонка заданной высоты (`flex flex-col` + `screen-fill`); поле ввода остаётся под лентой. На телефоне
   * ничего не меняет. Для экрана, где чат — всё содержимое.
   */
  fill?: boolean;
};

/** Запас «человек внизу», px: ниже этого расстояния до конца считаем, что он читает последнее. */
const NEAR_END = 24;

/**
 * Лента переписки. Мои сообщения справа на `accent-soft`, чужие слева на `surface` (тёмным остаётся только главная
 * кнопка экрана); время под подложкой мелким вторичным текстом; фото — превью-ссылки (без превью — заглушка);
 * системная строка по центру. Лента — `role="log"` (`aria-live="polite"`).
 *
 * `relative` у ленты — контекст позиционирования для скрытого автора (`sr-only`, absolute): без него в ленте со своей
 * прокруткой он выходит за неё и растягивает страницу на длину переписки.
 *
 * Прокрутка к последнему сообщению — после раскладки при показе, при новом сообщении (если человек был внизу или написал
 * сам) и при росте содержимого (загрузилось фото), пока человек внизу. По умолчанию двигается только сама лента;
 * окно — только с `pageScroll`. Клиентский компонент.
 */
export function Chat({ messages, composer, label, pageScroll = false, fill = false }: ChatProps) {
  const reduced = useReducedMotion() ?? false;
  const log = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  /** Человек внизу: обновляется прокруткой, читается при новом сообщении и росте содержимого. */
  const stick = useRef(true);
  const previousLastId = useRef<string | undefined>(undefined);
  const first = useRef(true);

  const isAtEnd = (): boolean => {
    if (pageScroll) {
      const rect = end.current?.getBoundingClientRect();
      return !rect || rect.bottom <= window.innerHeight + NEAR_END;
    }
    const node = log.current;
    return !node || node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_END;
  };

  const toEnd = (smooth: boolean) => {
    const behavior = smooth && !reduced ? "smooth" : "auto";
    if (pageScroll) {
      end.current?.scrollIntoView({ block: "end", behavior });
      return;
    }
    const node = log.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior });
  };

  // Положение человека: прокрутка ленты (или окна). Прокрутка самим компонентом тоже приводит сюда — «внизу» остаётся верным.
  useEffect(() => {
    const target: HTMLElement | Window | null = pageScroll ? window : log.current;
    if (!target) return;
    const onScroll = () => {
      stick.current = isAtEnd();
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
    // isAtEnd читает только refs и pageScroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageScroll]);

  // Рост содержимого (фото догрузилось, шрифт, раскладка): пока человек внизу, остаёмся внизу. Первый вызов — после раскладки.
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stick.current) toEnd(false);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // toEnd читает refs, pageScroll и reduced (для instant-прокрутки не важен).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageScroll]);

  const last = messages[messages.length - 1];
  useLayoutEffect(() => {
    const wasFirst = first.current;
    const follow = shouldFollow({
      previousLastId: previousLastId.current,
      lastId: last?.id,
      lastIsMine: Boolean(last?.mine),
      wasAtBottom: stick.current,
      firstRender: wasFirst,
    });
    previousLastId.current = last?.id;
    first.current = false;
    if (follow) {
      toEnd(!wasFirst);
      stick.current = true;
    }
    // toEnd — функция компонента, читает refs; зависимость — только смена последнего сообщения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, last?.mine]);

  const t = ru.app.kit.chat;
  return (
    <div className={cn("flex flex-col gap-3 mobile:flex-1", fill && "desktop:min-h-0 desktop:flex-1")}>
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label={label ?? t.log}
        className={cn("relative flex min-h-0 flex-1 flex-col", !pageScroll && (fill ? "desktop:overflow-y-auto" : "desktop:max-h-chat desktop:overflow-y-auto"))}
      >
        <div ref={content} className="flex flex-col gap-3">
          {messages.map((message) => {
            if (message.kind === "system") {
              return (
                <p key={message.id} className="px-4 py-2 text-center text-sub text-muted">
                  {message.text}
                </p>
              );
            }
            const mine = Boolean(message.mine);
            return (
              <article key={message.id} className={cn("flex max-w-4/5 flex-col gap-1", mine ? "ml-auto items-end" : "mr-auto items-start")}>
                <div className={cn("flex min-w-0 flex-col gap-2 rounded-card px-4 py-3 text-body text-ink", mine ? "bg-accent-soft" : "bg-surface")}>
                  <span className="sr-only">{`${message.author ?? (mine ? t.mine : t.theirs)}: `}</span>
                  {message.text && <p className="wrap-break-word whitespace-pre-wrap">{message.text}</p>}
                  {message.attachments && message.attachments.length > 0 && (
                    <ul className="grid grid-cols-2 gap-2">
                      {message.attachments.map((file) => (
                        <li key={file.id}>
                          <a href={file.url} target="_blank" rel="noreferrer" aria-label={file.name} className="block aspect-4/3 overflow-hidden rounded-field bg-line">
                            {file.previewUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={file.previewUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Время вне подложки: muted на accent-soft в светлой теме ниже 4,5:1, на canvas — выше. */}
                <span className="text-small text-muted">{message.time}</span>
              </article>
            );
          })}
          <div ref={end} aria-hidden className={cn("h-px", pageScroll && "mobile:chat-end")} />
        </div>
      </div>
      {composer}
    </div>
  );
}
