"use server";

import { z } from "zod";
import {
  CHAT_CLOSE_REASON_MAX,
  CHAT_MAX_LENGTH,
  closeChat,
  getChat,
  reopenChat,
  revokeClientPhone,
  sendMessage,
  shareClientPhone,
} from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

const offerId = z.string().min(1).max(64);

/** Обновление ленты опросом. Права (стороны отклика, оператор) проверяет companies.getChat. */
export const loadChat = action("companies.loadChat", z.object({ offerId }), async (input) => {
  const user = await requireUser();
  return getChat(user, input.offerId);
});

/** Отправка сообщения: писать могут только заказчик заявки и исполнитель отклика. Вложения подключит интегратор вместе с uploader. */
export const sendChatMessage = action(
  "companies.sendMessage",
  z.object({ offerId, text: z.string().max(CHAT_MAX_LENGTH * 2) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    return sendMessage(user, input.offerId, input.text, []);
  },
);

/** Оператор закрывает чат с причиной (ответ №19). Длину причины после trim проверяет companies.closeChat. */
export const closeChatAction = action(
  "companies.closeChat",
  z.object({ offerId, reason: z.string().max(CHAT_CLOSE_REASON_MAX * 2) }),
  async (input) => {
    const user = await requireUser("OPERATOR");
    await closeChat(user, input.offerId, input.reason);
  },
);

/** Оператор снова открывает закрытый чат. */
export const reopenChatAction = action("companies.reopenChat", z.object({ offerId }), async (input) => {
  const user = await requireUser("OPERATOR");
  await reopenChat(user, input.offerId);
});

/** Заказчик показывает свой телефон исполнителю отклика (№21): только после переписки, проверяет companies. */
export const shareClientPhoneAction = action("companies.shareClientPhone", z.object({ offerId }), async (input) => {
  const user = await requireUser("CLIENT");
  await shareClientPhone(user, input.offerId);
});

/** Заказчик скрывает свой телефон от исполнителя отклика. */
export const revokeClientPhoneAction = action("companies.revokeClientPhone", z.object({ offerId }), async (input) => {
  const user = await requireUser("CLIENT");
  await revokeClientPhone(user, input.offerId);
});
