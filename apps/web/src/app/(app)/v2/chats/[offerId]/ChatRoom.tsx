"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { Chat, ChatComposer, Notice } from "@/kit";
import type { Device } from "@/platform/device";
import { outcomeOf } from "../../../_shell/form";
import { loadChatAction, sendMessageAction } from "../actions";
import type { ChatRoomModel } from "../_parts/chat-view";
import { createGate, shouldPoll } from "../_parts/single-flight";

const t = ru.app.chat.room;

/** Как часто обновлять ленту, пока вкладка видна (как в v1). */
export const POLL_MS = 5_000;

const here = () => ({ pathname: window.location.pathname, search: window.location.search });

export type ChatRoomProps = {
  offerId: string;
  initial: ChatRoomModel;
  device: Device;
  /** Предел длины сообщения (из модуля). */
  maxLength: number;
};

/**
 * Лента диалога и поле ввода. Новые сообщения — опросом серверного действия раз в 5 с (не чаще одного запроса за раз,
 * не на скрытой вкладке); отправка — серверным действием, после успеха лента заменяется ответом (оптимистичного
 * добавления нет). Ошибка отправки — текст у поля, набранное остаётся. На телефоне прокручивается страница.
 */
export function ChatRoom({ offerId, initial, device, maxLength }: ChatRoomProps) {
  const [model, setModel] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  /** Поколение ленты: ответ опроса, начатого до отправки, устарел и не применяется. */
  const epoch = useRef(0);

  const leave = (href: string) => window.location.assign(href);

  const gates = useRef({ poll: createGate(), send: createGate() });

  const refresh = useCallback(async () => {
    const gate = gates.current.poll;
    if (!gate.enter()) return;
    const started = epoch.current;
    try {
      const outcome = outcomeOf(await loadChatAction({ offerId }), here());
      if (epoch.current !== started) return;
      if (outcome.kind === "success") setModel(outcome.data);
      else if (outcome.kind === "leave") leave(outcome.href);
    } catch {
      // Сеть пропала на секунду: следующий тик попробует снова.
    } finally {
      gate.leave();
    }
  }, [offerId]);

  useEffect(() => {
    const tick = () => {
      if (shouldPoll(document.visibilityState)) void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  /** Отправка: повторное нажатие, пока идёт прошлая, ничего не делает (одно сообщение). `false` — текст остаётся в поле. */
  const send = async (text: string): Promise<boolean> => {
    const gate = gates.current.send;
    if (!gate.enter()) return false;
    setError(null);
    epoch.current += 1;
    try {
      const outcome = outcomeOf(await sendMessageAction({ offerId, text }), here());
      epoch.current += 1;
      if (outcome.kind === "success") {
        setModel(outcome.data);
        return true;
      }
      if (outcome.kind === "leave") leave(outcome.href);
      else setError(outcome.error);
      return false;
    } catch {
      setError(t.sendFailed);
      return false;
    } finally {
      gate.leave();
    }
  };

  const composer = model.canWrite ? (
    <>
      {error && (
        <Notice tone="danger" live>
          {error}
        </Notice>
      )}
      <ChatComposer
        device={device}
        onSend={send}
        maxLength={maxLength}
        label={t.composerLabel}
        placeholder={t.composerPlaceholder}
      />
    </>
  ) : (
    <Notice tone="warn" title={t.closedTitle}>
      <p>{model.closedReason}</p>
      {model.operatorReason && <p>{t.closedReason(model.operatorReason)}</p>}
    </Notice>
  );

  // Компьютер: у ленты своя прокрутка, а скрытый автор сообщения (`sr-only`, absolute) без позиционированного предка
  // выходит за неё и растягивает страницу на всю длину переписки. Обёртка (relative + clip) держит его внутри.
  // TODO(kit): `relative` у ленты `Chat` убирает потребность в обёртке.
  return (
    <div className="desktop:relative desktop:overflow-clip desktop:[overflow-clip-margin:8px]">
      <Chat messages={model.messages} label={t.log} pageScroll={device === "mobile"} composer={composer} />
    </div>
  );
}
