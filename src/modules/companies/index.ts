import "server-only";

/**
 * Публичный API companies. Контракты (типы и сигнатуры) зафиксированы в фазе A,
 * реализация экспортируется отсюда под теми же именами.
 * Анонимность: заказчику исполнитель доступен только как PublicExecutorView.
 */
export type { GetPublicExecutorView, PublicExecutorView, RecalculateRating } from "./types";

export { publicExecutorView, publicExecutorViews } from "./anonymity";
export { recalculateRating } from "./rating";
export { MASK, maskContacts, maskIdentity, type MaskResult } from "./mask";
export { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, getChat, sendMessage, type ChatMessageView, type ChatView } from "./chat";

export const jobHandlers = {} as const;
