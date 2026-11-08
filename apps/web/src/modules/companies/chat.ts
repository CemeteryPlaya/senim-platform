import "server-only";
import { ru } from "@/i18n/ru";
import { recordAudit } from "@/modules/audit";
import { attachFiles } from "@/modules/files";
import { actorOf, formatPhone, type CurrentUser } from "@/modules/identity";
import { notify } from "@/modules/notifications";
import { db, transaction, type Db, type Prisma } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { isEnabled } from "@/platform/features";
import { logger } from "@/platform/logger";
import { enforceRateLimit } from "@/platform/rate-limit";
import type { DealStatus, OfferStatus, RequestStatus } from "@/generated/prisma/enums";
import { executorDisplayOf, executorDisplays } from "./anonymity";
import { chatClosedReason, chatPartyOf, moderationTarget, type ChatClosedReason, type ChatModerationAction, type ChatParty } from "./chat-policy";
import { partyContactsFor, type DealSides, type PartyContacts } from "./contacts";
import { chatTextRule, contactStage, type ChatTextRule, type ContactStage } from "./contacts-policy";
import { maskContacts } from "./mask";
import { sanitizePublicText } from "./own";
import { canShareClientPhone, clientPhoneTarget, consentPathOpen, executorSeesClientPhone, type ClientPhoneAction, type ClientPhoneFacts, type ClientPhoneState } from "./phone-policy";

/**
 * Чат отклика (ADR-003). Пишут только стороны отклика — заказчик заявки и исполнитель;
 * оператор читает. До заключения оферты текст маскируется до записи, исходный не хранится; wasMasked
 * фиксирует факт. После оферты маски нет, а стороны видят контакты друг друга (contacts-policy.ts).
 * Чужой чат для пользователя «не существует» (NOT_FOUND), чтобы не раскрывать id.
 * После завершения сделки чат открыт (гарантия); закрывает и открывает его оператор (ответ №19).
 */
export const CHAT_MAX_LENGTH = 2000;
export const CHAT_MAX_ATTACHMENTS = 5;
export const CHAT_CLOSE_REASON_MIN = 3;
export const CHAT_CLOSE_REASON_MAX = 500;
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
  /** Чат закрыт оператором (№19): причину видят обе стороны; null — не закрыт. */
  closedByOperator: { reason: string; at: Date } | null;
  /** Оператор: может закрыть или снова открыть чат. */
  canModerate: boolean;
  /** Телефон заказчика до оферты по согласию (№21, флаг clientPhoneConsent): исполнителю — номер, заказчику — показать/скрыть; null — ничего. */
  clientPhone: ClientPhoneView;
  /** Контакты другой стороны после заключения оферты (ТЗ п. 3); null — до оферты, у оператора и без сделки. */
  contacts: PartyContacts | null;
};

/**
 * executor — номер заказчика (E.164 для tel: и для показа), пока согласие действует и чат открыт;
 * client — согласие дано или его можно дать (переписка была, чат открыт); null — не показывать ничего.
 */
export type ClientPhoneView = { for: "executor"; phone: string; display: string } | { for: "client"; shared: boolean } | null;

type Party = ChatParty;

async function loadOffer(client: Db, offerId: string) {
  return client.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      chatClosedAt: true,
      chatClosedReason: true,
      clientPhoneSharedAt: true,
      requestId: true,
      executorId: true,
      executor: { select: { userId: true, publicNumber: true } },
      request: { select: { clientId: true, status: true } },
      deal: { select: { id: true, status: true, signedAt: true } },
    },
  });
}
type OfferContext = NonNullable<Awaited<ReturnType<typeof loadOffer>>>;

const sidesOf = (offer: OfferContext): DealSides => ({
  clientId: offer.request.clientId,
  executorUserId: offer.executor.userId,
  signedAt: offer.deal?.signedAt ?? null,
});

/** label — подпись исполнителя для заказчика (companies.executorDisplay, режим №6); stage — заключена ли оферта. */
type Loaded = { offer: OfferContext; party: Party; label: string; stage: ContactStage };

async function requireOffer(client: Db, user: CurrentUser, offerId: string): Promise<Loaded> {
  const offer = await loadOffer(client, offerId);
  const party = offer ? chatPartyOf(user, sidesOf(offer)) : null;
  if (!offer || !party) return fail.notFound(t.errors.notFound);
  return { offer, party, label: (await executorDisplayOf(client, offer.executorId)).label, stage: contactStage(offer.deal) };
}

type ClosedFacts = { status: OfferStatus; chatClosedAt: Date | null; request: { status: RequestStatus }; deal: { status: DealStatus } | null };

function closedReasonOf(offer: ClosedFacts): ChatClosedReason | null {
  return chatClosedReason({
    offerStatus: offer.status,
    requestStatus: offer.request.status,
    dealStatus: offer.deal?.status ?? null,
    closedByOperator: offer.chatClosedAt !== null,
  });
}

function closedReasonText(offer: OfferContext): string | null {
  const reason = closedReasonOf(offer);
  return reason ? t.closed[reason] : null;
}

function closedByOperator(offer: OfferContext): ChatView["closedByOperator"] {
  return offer.chatClosedAt ? { reason: offer.chatClosedReason ?? "", at: offer.chatClosedAt } : null;
}

function authorLabel(senderId: string, { offer, label }: Loaded): string {
  return senderId === offer.executor.userId ? label : t.clientLabel;
}

type MessageRow = { id: string; senderId: string; body: string; wasMasked: boolean; createdAt: Date; attachments: { id: string }[] };

function toView(row: MessageRow, viewer: CurrentUser, loaded: Loaded): ChatMessageView {
  const own = row.senderId === viewer.id;
  return {
    id: row.id,
    kind: own ? "own" : "other",
    author: own ? ru.common.ui.chat.you : authorLabel(row.senderId, loaded),
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
  const loaded = await requireOffer(db, user, offerId);
  const { offer, party } = loaded;
  const rows = await db.message.findMany({
    where: { offerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: MESSAGE_SELECT,
  });
  const closed = party === "operator" ? t.operatorReadOnly : closedReasonText(offer);
  return {
    offerId,
    messages: rows.reverse().map((row) => toView(row, user, loaded)),
    canWrite: closed === null,
    closedReason: closed,
    closedByOperator: closedByOperator(offer),
    canModerate: party === "operator",
    clientPhone: await clientPhoneView(loaded),
    contacts: await partyContactsFor(db, party, sidesOf(offer)),
  };
}

// ─── список диалогов (вкладка «Чат») ─────────────────────────────────────────

/** Строка списка диалогов: один отклик, в котором пользователь — сторона. */
export type ChatListItem = {
  offerId: string;
  /** Тип изделия и город из заявки. */
  title: string;
  /** Подпись собеседника: «Исполнитель №N» по режиму ADR-006 или «Заказчик». */
  counterpart: string;
  /** Последнее сообщение, уже замаскированное; null — переписки ещё нет. */
  lastMessage: string | null;
  lastAt: Date | null;
  closed: boolean;
  /** Существующий экран чата этого отклика. */
  href: string;
};

const CHAT_ANCHOR = "#chat";

function chatHref(offer: { id: string; requestId: string; deal: { id: string } | null }, party: "client" | "executor"): string {
  if (offer.deal) return `/deals/${offer.deal.id}${CHAT_ANCHOR}`;
  return party === "client" ? `/requests/${offer.requestId}/offers/${offer.id}${CHAT_ANCHOR}` : `/executor/requests/${offer.requestId}${CHAT_ANCHOR}`;
}

const CHAT_LIST_LIMIT = 100;

/** До 100 откликов пользователя: сначала с перепиской по времени последнего сообщения, затем без неё по дате отклика. */
async function latestOfferIds(owned: Prisma.OfferWhereInput): Promise<string[]> {
  const active = await db.message.groupBy({
    by: ["offerId"],
    where: { offer: owned },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: CHAT_LIST_LIMIT,
  });
  const ids = active.map((row) => row.offerId);
  if (ids.length >= CHAT_LIST_LIMIT) return ids;
  const silent = await db.offer.findMany({
    where: { ...owned, messages: { none: {} } },
    orderBy: { createdAt: "desc" },
    take: CHAT_LIST_LIMIT - ids.length,
    select: { id: true },
  });
  return [...ids, ...silent.map((o) => o.id)];
}

/**
 * Диалоги пользователя: отклики своих заявок (заказчик) или свои отклики (исполнитель) по активной роли — то же
 * правило владения, что у getChat (chatPartyOf). Оператор и замерщик получают пустой список. Текст превью —
 * как в getChat; до оферты дополнительно проходит maskContacts (на случай строки, записанной в обход сервиса).
 * Телефона, ФИО и наименования заказчика/исполнителя в строке нет, кроме подписи по режиму ADR-006.
 * Не больше 100 диалогов. Запросов к БД: исполнителю 2–3 (группировка по времени последнего сообщения, добор откликов без
 * переписки, если нет 100, отклики с последним сообщением вложенным take: 1); заказчику ещё 2 (профили и режим имени).
 */
export async function listChats(user: CurrentUser): Promise<ChatListItem[]> {
  const party = user.role === "CLIENT" ? "client" : user.role === "EXECUTOR" ? "executor" : null;
  if (party === null) return [];
  const owned: Prisma.OfferWhereInput = party === "client" ? { request: { clientId: user.id } } : { executor: { userId: user.id } };
  const ids = await latestOfferIds(owned);
  const offers = await db.offer.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      chatClosedAt: true,
      requestId: true,
      executorId: true,
      createdAt: true,
      request: { select: { status: true, city: true, customType: true, furnitureType: { select: { name: true } } } },
      deal: { select: { id: true, status: true, signedAt: true } },
      // Последнее сообщение — вложенный take: 1 по убыванию времени (один запрос на все отклики, без выборки истории).
      messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, createdAt: true } },
    },
  });
  const labels = party === "client" ? await executorDisplays(db, offers.map((o) => o.executorId)) : null;
  const items = offers.flatMap((offer) => {
    const counterpart = labels === null ? t.clientLabel : labels.get(offer.executorId)?.label;
    if (counterpart === undefined) {
      // Нет профиля исполнителя: одна строка не должна ронять весь список, а подпись выдумывать нельзя.
      logger.warn("chats.list.executor_missing", { offerId: offer.id, executorId: offer.executorId });
      return [];
    }
    const last = offer.messages[0] ?? null;
    const beforeOffer = contactStage(offer.deal) === "BEFORE_OFFER";
    // Та же логика, что requestTitle в requests/access.ts: companies не может импортировать requests (requests сам зависит от companies — цикл).
    const type = offer.request.furnitureType?.name ?? offer.request.customType ?? ru.requests.untitled;
    const item: ChatListItem = {
      offerId: offer.id,
      title: [type, offer.request.city].filter((part) => part.length > 0).join(" · "),
      counterpart,
      lastMessage: last ? (beforeOffer ? maskContacts(last.body).text : last.body) : null,
      lastAt: last?.createdAt ?? null,
      closed: closedReasonOf(offer) !== null,
      href: chatHref(offer, party),
    };
    return [{ createdAt: offer.createdAt, item }];
  });
  return items
    .sort((a, b) => (b.item.lastAt?.getTime() ?? -1) - (a.item.lastAt?.getTime() ?? -1) || b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ item }) => item);
}

/** Текст перед записью по правилу CONTACTS: до оферты — маска (у исполнителя и наименование/ФИО), после — как есть. */
async function applyTextRule(rule: ChatTextRule, executorId: string, body: string): Promise<{ text: string; masked: boolean }> {
  if (rule === "maskContactsAndName") return sanitizePublicText(db, executorId, body);
  if (rule === "maskContacts") return maskContacts(body);
  return { text: body, masked: false };
}

/** Сообщение в чат отклика: маска контактов, вложения (свои загруженные файлы), уведомление второй стороне. */
export async function sendMessage(user: CurrentUser, offerId: string, text: string, attachments: readonly string[]): Promise<ChatMessageView> {
  const body = text.trim();
  if (body.length === 0) return fail.validation(t.errors.empty);
  if (body.length > CHAT_MAX_LENGTH) return fail.validation(t.errors.tooLong(CHAT_MAX_LENGTH));
  const fileIds = [...new Set(attachments)];
  if (fileIds.length > CHAT_MAX_ATTACHMENTS) return fail.validation(t.errors.tooManyAttachments(CHAT_MAX_ATTACHMENTS));

  const loaded = await requireOffer(db, user, offerId);
  const { offer, party } = loaded;
  if (party === "operator") return fail.forbidden(t.operatorReadOnly);
  const closed = closedReasonText(offer);
  if (closed) return fail.conflict(closed);
  await enforceRateLimit(`chat:${user.id}`, SEND_RATE, t.errors.rateLimited);

  const { text: safeText, masked } = await applyTextRule(chatTextRule(loaded.stage, party), offer.executorId, body);
  const row = await transaction(async (tx) => {
    const message = await tx.message.create({ data: { offerId, senderId: user.id, body: safeText, wasMasked: masked } });
    if (fileIds.length > 0) await attachFiles(tx, { fileIds, uploadedById: user.id, owner: { messageId: message.id } });
    await notifyOtherParty(tx, party, loaded, safeText);
    if (masked) {
      await recordAudit(tx, {
        actor: actorOf(user),
        action: "chat.contacts_masked",
        entity: { type: "message", id: message.id },
        scope: scopeOf(offer),
        meta: { offerId },
      });
    }
    return tx.message.findUniqueOrThrow({ where: { id: message.id }, select: MESSAGE_SELECT });
  });
  return toView(row, user, loaded);
}

const scopeOf = (offer: OfferContext) => (offer.deal ? `deal:${offer.deal.id}` : `request:${offer.requestId}`);

/** Куда ведёт уведомление стороне: сделка, если она есть, иначе заявка глазами заказчика или исполнителя. */
function linkFor(offer: OfferContext, toClient: boolean): string {
  if (offer.deal) return `/deals/${offer.deal.id}`;
  return toClient ? `/requests/${offer.requestId}` : `/executor/requests/${offer.requestId}`;
}

async function notifyOtherParty(tx: Db, sender: "client" | "executor", { offer, label }: Loaded, text: string): Promise<void> {
  const toClient = sender === "executor";
  await notify(tx, {
    userId: toClient ? offer.request.clientId : offer.executor.userId,
    kind: "chat.message",
    title: t.notify.title(toClient ? label : t.clientLabel),
    body: text.length > NOTIFY_SNIPPET ? `${text.slice(0, NOTIFY_SNIPPET - 1)}…` : text,
    link: linkFor(offer, toClient),
  });
}

// ─── закрытие оператором (ответ №19) ─────────────────────────────────────────

const m = t.moderation;

async function notifyBothParties(tx: Db, offer: OfferContext, kind: string, title: string, body: string): Promise<void> {
  await notify(tx, { userId: offer.request.clientId, kind, title, body, link: linkFor(offer, true) });
  await notify(tx, { userId: offer.executor.userId, kind, title, body, link: linkFor(offer, false) });
}

/** Оператор и существующий отклик; проверка перехода по таблице CHAT_MODERATION. */
async function moderated(user: CurrentUser, offerId: string, action: ChatModerationAction): Promise<OfferContext> {
  if (user.role !== "OPERATOR") return fail.forbidden();
  const { offer } = await requireOffer(db, user, offerId);
  moderationTarget(action, offer.chatClosedAt ? "CLOSED" : "OPEN", user.role);
  return offer;
}

/**
 * Оператор закрывает чат с причиной: стороны только читают и видят причину. Переход — условным
 * updateMany по «ещё открыт»: двойной клик и параллельный запрос дают ровно одно закрытие (второй — CONFLICT).
 */
export async function closeChat(user: CurrentUser, offerId: string, reasonRaw: string): Promise<void> {
  if (user.role !== "OPERATOR") return fail.forbidden();
  const reason = reasonRaw.trim();
  if (reason.length < CHAT_CLOSE_REASON_MIN || reason.length > CHAT_CLOSE_REASON_MAX) {
    return fail.validation(m.reasonRequired(CHAT_CLOSE_REASON_MIN, CHAT_CLOSE_REASON_MAX));
  }
  const offer = await moderated(user, offerId, "close");
  await transaction(async (tx) => {
    const closedAt = new Date();
    expectOneUpdated(
      await tx.offer.updateMany({ where: { id: offerId, chatClosedAt: null }, data: { chatClosedAt: closedAt, chatClosedReason: reason } }),
      m.errors.close,
    );
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "chat.closed",
      entity: { type: "offer", id: offerId },
      scope: scopeOf(offer),
      before: { closed: false },
      after: { closed: true, reason },
    });
    await notifyBothParties(tx, offer, "chat.closed", m.notify.closed.title, m.notify.closed.body(reason));
  });
}

/** Оператор снова открывает закрытый им чат. Повтор — CONFLICT, без второй записи в журнале. */
export async function reopenChat(user: CurrentUser, offerId: string): Promise<void> {
  const offer = await moderated(user, offerId, "reopen");
  await transaction(async (tx) => {
    expectOneUpdated(
      await tx.offer.updateMany({ where: { id: offerId, chatClosedAt: { not: null } }, data: { chatClosedAt: null, chatClosedReason: null } }),
      m.errors.reopen,
    );
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "chat.reopened",
      entity: { type: "offer", id: offerId },
      scope: scopeOf(offer),
      before: { closed: true, reason: offer.chatClosedReason },
      after: { closed: false },
    });
    await notifyBothParties(tx, offer, "chat.reopened", m.notify.reopened.title, m.notify.reopened.body);
  });
}

// ─── телефон заказчика исполнителю (ответ №21, ADR-008) ──────────────────────

const ph = t.phone;
const phoneState = (offer: OfferContext): ClientPhoneState => (offer.clientPhoneSharedAt ? "SHOWN" : "HIDDEN");

/** «Поговорили»: в чате отклика есть хотя бы одно сообщение заказчика и хотя бы одно исполнителя. */
async function talked(offer: OfferContext): Promise<boolean> {
  const senders = await db.message.findMany({
    where: { offerId: offer.id, senderId: { in: [offer.request.clientId, offer.executor.userId] } },
    distinct: ["senderId"],
    select: { senderId: true },
  });
  return senders.length === 2;
}

/** Факты для правила CLIENT_PHONE без «поговорили» (его считаем, только когда нужно: лишний запрос). */
const phoneFacts = ({ offer, stage }: Loaded): Omit<ClientPhoneFacts, "talked"> => ({
  state: phoneState(offer),
  chatClosed: closedReasonOf(offer),
  consentEnabled: isEnabled("clientPhoneConsent"),
  stage,
});

async function clientPhoneView(loaded: Loaded): Promise<ClientPhoneView> {
  const { offer, party } = loaded;
  const base = phoneFacts(loaded);
  const { state, chatClosed } = base;
  if (party === "executor") {
    if (!executorSeesClientPhone(base)) return null;
    const { phone } = await db.user.findUniqueOrThrow({ where: { id: offer.request.clientId }, select: { phone: true } });
    return { for: "executor", phone, display: formatPhone(phone) };
  }
  if (party !== "client" || !consentPathOpen(base)) return null;
  if (state === "SHOWN") return { for: "client", shared: true };
  const facts: ClientPhoneFacts = { ...base, talked: chatClosed === null && (await talked(offer)) };
  return canShareClientPhone(facts) ? { for: "client", shared: false } : null;
}

/**
 * Показать или скрыть телефон: только заказчик заявки (таблица CLIENT_PHONE). Переход — условным
 * updateMany по ожидаемому состоянию: повтор, двойной клик и параллельный запрос дают один эффект,
 * второй — CONFLICT. Номер не пишется ни в журнал, ни в уведомление. Если отклик закроется параллельно
 * с согласием, номер всё равно не будет виден: видимость проверяется при каждом чтении.
 */
async function switchClientPhone(user: CurrentUser, offerId: string, action: ClientPhoneAction): Promise<void> {
  const loaded = await requireOffer(db, user, offerId);
  const { offer, party } = loaded;
  const share = action === "share";
  const facts: ClientPhoneFacts = { ...phoneFacts(loaded), talked: share && (await talked(offer)) };
  clientPhoneTarget(action, facts, party);
  await transaction(async (tx) => {
    expectOneUpdated(
      await tx.offer.updateMany({
        where: { id: offerId, clientPhoneSharedAt: share ? null : { not: null } },
        data: { clientPhoneSharedAt: share ? new Date() : null },
      }),
      ph.errors[action],
    );
    await recordAudit(tx, {
      actor: actorOf(user),
      action: share ? "offer.client_phone_shared" : "offer.client_phone_revoked",
      entity: { type: "offer", id: offerId },
      scope: scopeOf(offer),
      before: { shared: !share },
      after: { shared: share },
    });
    if (share) {
      await notify(tx, { userId: offer.executor.userId, kind: "offer.client_phone_shared", title: ph.notify.title, body: ph.notify.body, link: linkFor(offer, false) });
    }
  });
}

/** Заказчик показывает свой телефон исполнителю отклика до оферты — под флагом clientPhoneConsent, после переписки и пока чат открыт. */
export async function shareClientPhone(user: CurrentUser, offerId: string): Promise<void> {
  await switchClientPhone(user, offerId, "share");
}

/** Заказчик скрывает телефон; можно в любой момент, в том числе в закрытом чате. */
export async function revokeClientPhone(user: CurrentUser, offerId: string): Promise<void> {
  await switchClientPhone(user, offerId, "revoke");
}
