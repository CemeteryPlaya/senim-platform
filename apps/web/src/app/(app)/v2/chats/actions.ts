"use server";

import { z } from "zod";
import { CHAT_MAX_LENGTH, getChat, sendMessage } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { chatRoomModel } from "./_parts/chat-view";

// Действия экрана диалога (v2). Свои обёртки над теми же функциями модуля `companies`, что и в v1: схема zod, затем
// `requireUser(...)` первой строкой; право на конкретный диалог (стороны отклика) и маску контактов проверяет модуль.
// Роли — обе стороны отклика: так же диалог переиспользует экран мастера.

const offerId = z.string().min(1).max(64);

/** Обновление ленты опросом (раз в 5 с, пока вкладка видна). Чужой диалог — NOT_FOUND из модуля. */
export const loadChatAction = action("app.chat.load", z.strictObject({ offerId }), async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return chatRoomModel(await getChat(user, input.offerId));
});

/**
 * Отправка сообщения. Ответ — вся лента после записи (свежее сообщение уже в ней): оптимистичного добавления нет.
 * Вложений нет: модулю отдаётся пустой список (отправка фото в чат — вне этого экрана).
 */
export const sendMessageAction = action(
  "app.chat.send",
  z.strictObject({ offerId, text: z.string().max(CHAT_MAX_LENGTH * 2) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    await sendMessage(user, input.offerId, input.text, []);
    return chatRoomModel(await getChat(user, input.offerId));
  },
);
