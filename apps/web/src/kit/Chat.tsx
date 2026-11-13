"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { ru } from "@/i18n/ru";
import { shouldFollow } from "./chat-logic";
import { cn } from "./cn";

export type ChatAttachment = { id: string; url: string; name: string };

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
};

/**
 * Лента переписки. Мои сообщения справа на `accent-soft`, чужие слева на `surface` (тёмным остаётся только главная
 * кнопка экрана); время под подложкой мелким вторичным текстом; фото — превью-ссылки; системная строка по центру.
 * Лента — `role="log"` (`aria-live="polite"`). Прокрутка к последнему сообщению при показе и при новом, если человек был
 * внизу (или написал сам). Клиентский компонент.
 */
export function Chat({ messages, composer, label }: ChatProps) {
  const reduced = useReducedMotion() ?? false;
  const end = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previousLastId = useRef<string | undefined>(undefined);
  const first = useRef(true);

  // Внизу ли человек: конец ленты в зоне видимости (с запасом 24 px). IntersectionObserver учитывает и прокрутку
  // страницы (телефон), и прокрутку самой ленты (компьютер).
  useEffect(() => {
    const node = end.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) atBottom.current = entry.isIntersecting;
      },
      { rootMargin: "0px 0px 24px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const last = messages[messages.length - 1];
  useEffect(() => {
    const follow = shouldFollow({
      previousLastId: previousLastId.current,
      lastId: last?.id,
      lastIsMine: Boolean(last?.mine),
      wasAtBottom: atBottom.current,
      firstRender: first.current,
    });
    previousLastId.current = last?.id;
    const wasFirst = first.current;
    first.current = false;
    if (follow) end.current?.scrollIntoView({ block: "end", behavior: reduced || wasFirst ? "auto" : "smooth" });
  }, [last?.id, last?.mine, reduced]);

  const t = ru.app.kit.chat;
  return (
    <div className="flex flex-col gap-3 mobile:flex-1">
      <div
        role="log"
        aria-live="polite"
        aria-label={label ?? t.log}
        className="flex min-h-0 flex-1 flex-col gap-3 desktop:max-h-chat desktop:overflow-y-auto"
      >
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
                        <a href={file.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-field bg-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={file.url} alt={file.name} loading="lazy" decoding="async" className="aspect-4/3 size-full object-cover" />
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
        <div ref={end} aria-hidden className="h-px mobile:chat-end" />
      </div>
      {composer}
    </div>
  );
}
