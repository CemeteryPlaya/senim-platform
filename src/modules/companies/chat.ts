import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { db, transaction, type Db } from "@/platform/db";
import { fail } from "@/platform/errors";
import { enforceRateLimit } from "@/platform/rate-limit";
import { chatClosedReason } from "./chat-policy";
import { maskContacts } from "./mask";
import { sanitizePublicText } from "./own";

/**
 * Чат отклика (ADR-003). Пишут только стороны отклика — заказчик заявки и исполнитель;
 * оператор читает. Текст маскируется до записи, исходный не хранится; wasMasked фиксирует факт.
 * Чужой чат для пользователя «не существует» (NOT_FOUND), чтобы не раскрывать id.
 */
export const CHAT_MAX_LENGTH = 2000;
export const CHAT_MAX_ATTACHMENTS = 5;
const HISTORY_LIMIT = 500;
const SEND_RATE = { limit: 30, windowSec: 60 };
const NOTIFY_SNIPPET = 140;

const t = ru.companies.chat;

export type ChatMessageView = {
  id: string;
  kind: "own" | "other";
  author: string;
  text: string;
  sentAt: Date;
  masked: boolean;
  attachments: { id: string }[];
};

export type ChatView = {
  offerId: string;
  messages: ChatMessageView[];
  canWrite: boolean;
  /** Почему писать нельзя (для поля ввода); null — можно. */
  closedReason: string | null;
};

type Party = "client" | "executor" | "operator";

async function loadOffer(client: Db, offerId: string) {
  return client.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      requestId: true,
      executorId: true,
      executor: { select: { userId: true, publicNumber: true } },
      request: { select: { clientId: true, status: true } },
      deal: { select: { id: true, status: true } },
    },
  });
}
type OfferContext = NonNullable<Awaited<ReturnType<typeof loadOffer>>>;

function partyOf(user: CurrentUser, offer: OfferContext): Party | null {
  if (user.role === "OPERATOR") return "operator";
  if (user.role === "CLIENT" && offer.request.clientId === user.id) return "client";
  if (user.role === "EXECUTOR" && offer.executor.userId === user.id) return "executor";
  return null;
}

async function requireOffer(client: Db, user: CurrentUser, offerId: string): Promise<{ offer: OfferContext; party: Party }> {
  const offer = await loadOffer(client, offerId);
  const party = offer ? partyOf(user, offer) : null;
  if (!offer || !party) return fail.notFound(t.errors.notFound);
  return { offer, party };
}

function closedReasonText(offer: OfferContext): string | null {
  const reason = chatClosedReason({ offerStatus: offer.status, requestStatus: offer.request.status, dealStatus: offer.deal?.status ?? null });
  return reason ? t.closed[reason] : null;
}

function authorLabel(senderId: string, offer: OfferContext): string {
  return senderId === offer.executor.userId ? ru.common.executorLabel(offer.executor.publicNumber) : t.clientLabel;
}

type MessageRow = { id: string; senderId: string; body: string; wasMasked: boolean; createdAt: Date; attachments: { id: string }[] };

function toView(row: MessageRow, viewer: CurrentUser, offer: OfferContext): ChatMessageView {
  const own = row.senderId === viewer.id;
  return {
    id: row.id,
    kind: own ? "own" : "other",
    author: own ? ru.common.ui.chat.you : authorLabel(row.senderId, offer),
    text: row.body,
    sentAt: row.createdAt,
    masked: row.wasMasked,
    attachments: row.attachments,
  };
}

const MESSAGE_SELECT = {
  id: true,
  senderId: true,
  body: true,
  wasMasked: true,
  createdAt: true,
  attachments: { select: { id: true }, orderBy: { sortOrder: "asc" } },
} as const;

/** История переписки по отклику и право писать. Стороны отклика и оператор. */
export async function getChat(user: CurrentUser, offerId: string): Promise<ChatView> {
  const { offer, party } = await requireOffer(db, user, offerId);
  const rows = await db.message.findMany({
    where: { offerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: MESSAGE_SELECT,
  });
  const closed = party === "operator" ? t.operatorReadOnly : closedReasonText(offer);
  return {
    offerId,
    messages: rows.reverse().map((row) => toView(row, user, offer)),
    canWrite: closed === null,
    closedReason: closed,
  };
}

/** Сообщение в чат отклика: маска контактов, вложения (свои загруженные файлы), уведомление второй стороне. */
export async function sendMessage(user: CurrentUser, offerId: string, text: string, attachments: readonly string[]): Promise<ChatMessageView> {
  const body = text.trim();
  if (body.length === 0) return fail.validation(t.errors.empty);
  if (body.length > CHAT_MAX_LENGTH) return fail.validation(t.errors.tooLong(CHAT_MAX_LENGTH));
  const fileIds = [...new Set(attachments)];
  if (fileIds.length > CHAT_MAX_ATTACHMENTS) return fail.validation(t.errors.tooManyAttachments(CHAT_MAX_ATTACHMENTS));

  const { offer, party } = await requireOffer(db, user, offerId);
  if (party === "operator") return fail.forbidden(t.operatorReadOnly);
  const closed = closedReasonText(offer);
  if (closed) return fail.conflict(closed);
  await enforceRateLimit(`chat:${user.id}`, SEND_RATE, t.errors.rateLimited);

  // Исполнитель — ещё и без своего наименования/ФИО (анонимность до договора); заказчик — без контактов.
  const { text: safeText, masked } = party === "executor" ? await sanitizePublicText(db, offer.executorId, body) : maskContacts(body);
  const row = await transaction(async (tx) => {
    const message = await tx.message.create({ data: { offerId, senderId: user.id, body: safeText, wasMasked: masked } });
    await attachFiles(tx, user, message.id, fileIds);
    await notifyOtherParty(tx, party, offer, safeText);
    if (masked) {
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "chat.contacts_masked",
        entity: { type: "message", id: message.id },
        scope: offer.deal ? `deal:${offer.deal.id}` : `request:${offer.requestId}`,
        meta: { offerId },
      });
    }
    return tx.message.findUniqueOrThrow({ where: { id: message.id }, select: MESSAGE_SELECT });
  });
  return toView(row, user, offer);
}

/** Привязка только своих, ещё ни к чему не привязанных файлов чата; условие в самом UPDATE — без гонки. */
async function attachFiles(tx: Db, user: CurrentUser, messageId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const result = await tx.storedFile.updateMany({
    where: {
      id: { in: fileIds },
      uploadedById: user.id,
      purpose: "MESSAGE",
      messageId: null,
      portfolioItemId: null,
      requestId: null,
      stageId: null,
      disputeId: null,
      visualizationId: null,
    },
    data: { messageId },
  });
  if (result.count !== fileIds.length) fail.validation(t.errors.badAttachment);
}

async function notifyOtherParty(tx: Db, sender: "client" | "executor", offer: OfferContext, text: string): Promise<void> {
  const toClient = sender === "executor";
  const link = offer.deal
    ? `/deals/${offer.deal.id}`
    : toClient
      ? `/requests/${offer.requestId}`
      : `/executor/requests/${offer.requestId}`;
  await notify(tx, {
    userId: toClient ? offer.request.clientId : offer.executor.userId,
    kind: "chat.message",
    title: t.notify.title(toClient ? ru.common.executorLabel(offer.executor.publicNumber) : t.clientLabel),
    body: text.length > NOTIFY_SNIPPET ? `${text.slice(0, NOTIFY_SNIPPET - 1)}…` : text,
    link,
  });
}
