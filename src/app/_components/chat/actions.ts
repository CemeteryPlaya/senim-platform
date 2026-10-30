"use server";

import { z } from "zod";
import { CHAT_MAX_LENGTH, getChat, sendMessage } from "@/modules/companies";
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
