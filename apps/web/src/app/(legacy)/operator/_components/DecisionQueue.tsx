"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "@/ui";
import { nextQueueFocus } from "./queue-focus";

/** Решение по карточке принято: что объявить и из какого элемента карточки (форма) оно пришло. */
type Decided = (message: string, from: HTMLElement) => void;

const QueueContext = createContext<Decided | null>(null);

/** Для форм внутри карточки очереди; вне DecisionQueue — null (форма ведёт себя как обычно). */
export function useQueueDecision(): Decided | null {
  return useContext(QueueContext);
}

const ITEMS = "[data-queue] > li";

export type DecisionQueueProps = {
  /** Сколько карточек в очереди сейчас (с сервера): изменилось — экран обновился, пора переводить фокус. */
  count: number;
  /** id заголовка пустого состояния (EmptyState titleId): сюда фокус, когда решена последняя карточка. */
  emptyTitleId: string;
  /** Список — <ul data-queue> из ListCard, или пустое состояние. */
  children: ReactNode;
};

/**
 * Очередь решений оператора (деньги в банке, KYC): после решения карточка исчезает вместе с формой, её
 * сообщением и фокусом. Поэтому итог объявляет общая область role="status" над списком, а фокус после
 * обновления экрана встаёт на заголовок следующей карточки или, если очередь пуста, на заголовок пустого состояния.
 */
export function DecisionQueue({ count, emptyTitleId, children }: DecisionQueueProps) {
  const root = useRef<HTMLDivElement>(null);
  const decidedAt = useRef<number | null>(null);
  const [message, setMessage] = useState("");

  const decided = useCallback<Decided>((text, from) => {
    const items = Array.from(root.current?.querySelectorAll(ITEMS) ?? []);
    const item = from.closest(ITEMS);
    decidedAt.current = item ? items.indexOf(item) : -1;
    setMessage(text);
  }, []);

  useEffect(() => {
    const index = decidedAt.current;
    if (index === null || !root.current) return;
    decidedAt.current = null;
    const items = root.current.querySelectorAll<HTMLElement>(ITEMS);
    const next = nextQueueFocus(index, items.length);
    const target = next === null ? document.getElementById(emptyTitleId) : items[next]?.querySelector<HTMLElement>("h2, h3");
    target?.focus();
  }, [count, emptyTitleId]);

  return (
    <QueueContext.Provider value={decided}>
      <div ref={root} className="flex flex-col gap-6">
        {/* Область есть всегда (пустая — вне потока): иначе первое объявление диктор пропустит. */}
        <div role="status" className={message ? undefined : "sr-only"}>
          {message && <Alert tone="success">{message}</Alert>}
        </div>
        {children}
      </div>
    </QueueContext.Provider>
  );
}
