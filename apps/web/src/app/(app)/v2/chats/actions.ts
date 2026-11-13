"use server";

import { z } from "zod";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, chatAttachments, getChat, sendMessage } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { chatRoomModel } from "./_parts/chat-view";

// Действия экрана диалога (v2). Свои обёртки над теми же функциями модуля `companies`, что и в v1: схема zod, затем
// `requireUser(...)` первой строкой; право на конкретный диалог (стороны отклика) и маску контактов проверяет модуль.
// Роли — обе стороны отклика: так же диалог переиспользует экран мастера.

const offerId = z.string().min(1).max(64);

/** Диалог и адреса вложений (права обеих проверяет модуль). */
async function roomOf(user: Parameters<typeof getChat>[0], id: string) {
  const [view, attachments] = await Promise.all([getChat(user, id), chatAttachments(user, id)]);
  return chatRoomModel(view, attachments);
}

/** Обновление ленты опросом (раз в 5 с, пока вкладка видна). Чужой диалог — NOT_FOUND из модуля. */
export const loadChatAction = action("app.chat.load", z.strictObject({ offerId }), async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return roomOf(user, input.offerId);
});

/**
 * Отправка сообщения. Ответ — вся лента после записи (свежее сообщение уже в ней): оптимистичного добавления нет.
 * Фото — id файлов, уже загруженных общим `v2/_upload` с назначением MESSAGE; число, владение и назначение проверяет
 * модуль (не больше CHAT_MAX_ATTACHMENTS). Сообщение только с фото без текста модуль не принимает («Напишите сообщение»).
 */
export const sendMessageAction = action(
  "app.chat.send",
  z.strictObject({
    offerId,
    text: z.string().max(CHAT_MAX_LENGTH * 2),
    fileIds: z.array(z.string().min(1).max(64)).max(CHAT_MAX_ATTACHMENTS).default([]),
  }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    await sendMessage(user, input.offerId, input.text, input.fileIds);
    return roomOf(user, input.offerId);
  },
);
