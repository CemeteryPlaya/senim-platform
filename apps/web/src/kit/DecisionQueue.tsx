"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Notice } from "./Notice";
import { nextQueueFocus } from "./queue-logic";

/** Решение по карточке принято: что объявить и из какого элемента карточки (обычно форма) оно пришло. */
export type QueueDecided = (message: string, from: HTMLElement | null) => void;

const QueueContext = createContext<QueueDecided | null>(null);

/**
 * Для формы внутри карточки очереди: вызвать после успешного решения (`onSuccess` формы) с текстом итога и формой —
 * очередь объявит итог и переведёт фокус, когда экран обновится. Вне `DecisionQueue` — `null` (форма ведёт себя как обычно).
 */
export function useQueueDecision(): QueueDecided | null {
  return useContext(QueueContext);
}

const ITEMS = "[data-queue] > li";

export type DecisionQueueProps = {
  /** Сколько карточек в очереди сейчас (с сервера): число изменилось — экран обновился, пора переводить фокус. */
  count: number;
  /** Имя списка для диктора («Операции ждут документа банка»). */
  label: string;
  /** Очередь пуста: обучающий пустой экран; когда решена последняя карточка, фокус — на его заголовок. */
  empty: { title: string; body: string };
  /** Карточки — `QueueCard`, по одной на решение. */
  children?: ReactNode;
};

/**
 * Очередь решений оператора (деньги в банке, документы мастеров, отзывы согласий, регистрации): после решения карточка
 * исчезает вместе со своей формой, её сообщением и фокусом. Поэтому итог объявляет общая область `role="status"` над
 * списком (видна плашкой `Notice`), а фокус после обновления экрана встаёт на заголовок карточки, занявшей место решённой
 * (решена последняя — на новую последнюю; очередь опустела — на заголовок пустого состояния). Так человек с клавиатурой и
 * с диктором не теряет место в очереди. Повторное решение одной карточки не даёт двойного эффекта — это защищает модуль,
 * а не очередь.
 */
export function DecisionQueue({ count, label, empty, children }: DecisionQueueProps) {
  const root = useRef<HTMLDivElement>(null);
  const decidedAt = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  const emptyId = useId();

  const decided = useCallback<QueueDecided>((text, from) => {
    const items = Array.from(root.current?.querySelectorAll(ITEMS) ?? []);
    const item = from?.closest(ITEMS) ?? null;
    decidedAt.current = item ? items.indexOf(item) : -1;
    setMessage(text);
  }, []);

  useEffect(() => {
    const index = decidedAt.current;
    if (index === null || !root.current) return;
    decidedAt.current = null;
    const items = root.current.querySelectorAll<HTMLElement>(ITEMS);
    const next = nextQueueFocus(index, items.length);
    const target = next === null ? document.getElementById(emptyId) : items[next]?.querySelector<HTMLElement>("h2, h3");
    target?.focus();
  }, [count, emptyId]);

  return (
    <QueueContext.Provider value={decided}>
      <div ref={root} className="flex min-w-0 flex-col gap-stack-group">
        {/* Область есть всегда (пустая — вне потока): иначе первое объявление диктор пропустит. */}
        <div role="status" className={message ? undefined : "sr-only"}>
          {message && <Notice tone="info">{message}</Notice>}
        </div>
        {count === 0 ? (
          <EmptyState title={empty.title} body={empty.body} titleId={emptyId} />
        ) : (
          <ul data-queue aria-label={label} className="flex flex-col gap-stack-group">
            {children}
          </ul>
        )}
      </div>
    </QueueContext.Provider>
  );
}

export type QueueCardProps = {
  /** Заголовок карточки («Операция по сделке №41»): на него встаёт фокус после решения соседней. */
  title: string;
  /** Строка под заголовком (вторичный текст): сумма, срок, кто ждёт. */
  meta?: ReactNode;
  /** Уровень заголовка: 2 — очередь сразу под `<h1>` экрана, 3 — внутри раздела. */
  headingLevel?: 2 | 3;
  /** Содержимое и форма решения. */
  children?: ReactNode;
};

/** Карточка очереди решений: `<li>` в списке `DecisionQueue`, заголовок с `tabIndex=-1` (цель фокуса), строка и форма. */
export function QueueCard({ title, meta, headingLevel = 2, children }: QueueCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Card as="li" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Heading tabIndex={-1} className="text-headline text-ink wrap-break-word">
          {title}
        </Heading>
        {meta && <div className="text-sub text-muted">{meta}</div>}
      </div>
      {children}
    </Card>
  );
}
