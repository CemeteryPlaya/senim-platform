"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PHOTO_ACCEPT } from "@/features/upload/transfer";
import { ru } from "@/i18n/ru";
import { Chat, ChatComposer, Notice, toast, Uploader } from "@/kit";
import type { Device } from "@/platform/device";
import { randomKey } from "../../../_shell/client-key";
import { outcomeOf } from "../../../_shell/form";
import type { DealSide } from "../../../_shell/side";
import { usePhotoUploads } from "../../_upload/usePhotoUploads";
import { loadChatAction, sendMessageAction } from "../actions";
import type { ChatRoomModel } from "../_parts/chat-view";
import { mergeRoom, type RoomState } from "../_parts/room-state";
import { createGate, shouldPoll } from "../_parts/single-flight";

const t = ru.app.chat.room;
const tm = ru.app.masterDeal.chat.room;

/** Как часто обновлять ленту, пока вкладка видна (как в v1). */
export const POLL_MS = 5_000;
/** Пауза опроса после «слишком часто» от сервера. */
const PAUSE_MS = 30_000;

const here = () => ({ pathname: window.location.pathname, search: window.location.search });

export type ChatRoomProps = {
  offerId: string;
  initial: ChatRoomModel;
  /** Чьими глазами: подписи ленты и поля ввода называют собеседника (мастеру — покупатель, покупателю — мастер). */
  side: DealSide;
  device: Device;
  /** Предел длины сообщения (из модуля). */
  maxLength: number;
  /** Предел числа фото в сообщении (из модуля). */
  maxAttachments: number;
};

type Attached = { fileIds: string[]; busy: boolean };

/**
 * Фото к сообщению: загрузка общим автоматом `v2/_upload` с назначением MESSAGE (то же, что у модуля files для чата),
 * превью и «Убрать». Своё состояние — перемонтируется после отправки (ключ), сообщает наверх id готовых файлов.
 */
function AttachPanel({ max, onChange }: { max: number; onChange: (state: Attached) => void }) {
  const uploads = usePhotoUploads("MESSAGE", [], t.photo);
  const ids = uploads.fileIds.join(",");
  useEffect(() => {
    onChange({ fileIds: ids ? ids.split(",") : [], busy: uploads.busy });
  }, [ids, uploads.busy, onChange]);
  return (
    <Uploader
      label={t.attach.title}
      items={uploads.items}
      onAdd={uploads.add}
      onRemove={uploads.remove}
      onRetry={uploads.retry}
      onReject={(_files, reason) => toast.error(reason === "type" ? t.attach.notPhoto : t.attach.limit(max))}
      max={max}
      accept={PHOTO_ACCEPT}
      capture="environment"
    />
  );
}

/**
 * Лента диалога и поле ввода. Новые сообщения — опросом серверного действия раз в 5 с (не чаще одного запроса за раз,
 * не на скрытой вкладке); отправка — серверным действием, после успеха лента заменяется ответом (оптимистичного
 * добавления нет). Ошибка отправки — текст у поля, набранное остаётся. На телефоне прокручивается страница.
 */
export function ChatRoom({ offerId, initial, side, device, maxLength, maxAttachments }: ChatRoomProps) {
  const words = side === "EXECUTOR" ? tm : t;
  const [room, setRoom] = useState<RoomState>(() => ({ model: initial, urlsAt: Date.now() }));
  const { model } = room;
  /** До какого времени опрос молчит (лимит частоты на сервере): без ошибки на экране. */
  const pausedUntil = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attached, setAttached] = useState<Attached>({ fileIds: [], busy: false });
  /** Растёт после отправки: панель фото перемонтируется пустой. */
  const [panelKey, setPanelKey] = useState(0);
  /** Поколение ленты: ответ опроса, начатого до отправки, устарел и не применяется. */
  const epoch = useRef(0);

  const leave = (href: string) => window.location.assign(href);

  const gates = useRef({ poll: createGate(), send: createGate() });
  /** Последняя неудачная отправка: её ключ повтора и текст. */
  const pending = useRef<{ key: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const gate = gates.current.poll;
    if (!gate.enter()) return;
    const started = epoch.current;
    try {
      const result = await loadChatAction({ offerId });
      if (!result.ok && result.code === "RATE_LIMITED") pausedUntil.current = Date.now() + PAUSE_MS;
      const outcome = outcomeOf(result, here());
      if (epoch.current !== started) return;
      if (outcome.kind === "success") setRoom((prev) => mergeRoom(prev, outcome.data, Date.now()));
      else if (outcome.kind === "leave") leave(outcome.href);
    } catch {
      // Сеть пропала на секунду: следующий тик попробует снова.
    } finally {
      gate.leave();
    }
  }, [offerId]);

  useEffect(() => {
    const tick = () => {
      if (shouldPoll(document.visibilityState) && Date.now() >= pausedUntil.current) void refresh();
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
    if (attached.busy) {
      gate.leave();
      setError(t.attach.wait);
      return false;
    }
    setError(null);
    epoch.current += 1;
    // Ключ повтора: та же отправка (тот же текст после сбоя) — тот же ключ, и записанное до обрыва сообщение не задвоится;
    // изменённый текст — новое сообщение, новый ключ.
    const clientKey = pending.current?.text === text ? pending.current.key : randomKey();
    pending.current = { key: clientKey, text };
    try {
      const outcome = outcomeOf(await sendMessageAction({ offerId, text, fileIds: attached.fileIds, clientKey }), here());
      epoch.current += 1;
      if (outcome.kind === "success") {
        pending.current = null;
        setRoom((prev) => mergeRoom(prev, outcome.data, Date.now()));
        setAttachOpen(false);
        setAttached({ fileIds: [], busy: false });
        setPanelKey((key) => key + 1);
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
      {attachOpen && !model.beforeOffer && <AttachPanel key={panelKey} max={maxAttachments} onChange={setAttached} />}
      <ChatComposer
        device={device}
        onSend={send}
        onAttach={model.beforeOffer ? undefined : () => setAttachOpen(true)}
        allowEmpty={attached.fileIds.length > 0}
        maxLength={maxLength}
        label={words.composerLabel}
        placeholder={words.composerPlaceholder}
      />
    </>
  ) : (
    <Notice tone="warn" title={t.closedTitle}>
      <p>{model.closedReason}</p>
      {model.operatorReason && <p>{t.closedReason(model.operatorReason)}</p>}
    </Notice>
  );

  return <Chat messages={model.messages} label={words.log} pageScroll={device === "mobile"} fill composer={composer} />;
}
