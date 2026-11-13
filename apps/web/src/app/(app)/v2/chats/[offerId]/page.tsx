import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Explain, Narrow, PageTitle, Stack, TextLink } from "@/kit";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, chatAttachments, getChat, listChats } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireBuyer } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { chatHref, chatRoomModel, contextLink, contextOfHref } from "../_parts/chat-view";
import { ChatRoom } from "./ChatRoom";

const t = ru.app.chat.room;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ offerId: string }> };

/**
 * Диалог покупателя с мастером по одному предложению. Шапка: «Назад: Чаты», собеседник (то, что отдаёт модуль:
 * «Исполнитель №N» до оферты, имя после), ссылка на предложение или сделку. Экран — лента и поле ввода; главного
 * действия и дока нет, поле — последний элемент. Чужой и несуществующий диалог — 404 (модуль: NOT_FOUND).
 */
export default async function ChatPage({ params }: Props) {
  const { offerId } = await params;
  const user = await requireBuyer(chatHref(offerId));
  const loaded = await Promise.all([getChat(user, offerId), chatAttachments(user, offerId)]).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [view, attachments] = loaded;
  // Собеседник и «к чему относится» — из списка диалогов (один запрос; чат-вид их не несёт).
  const item = (await listChats(user)).find((chat) => chat.offerId === offerId) ?? null;
  const model = chatRoomModel(view, attachments);
  const device = await getDevice();
  const link = item ? contextLink(contextOfHref(item.href, offerId), item.title) : null;

  const lead = (
    <span className="flex flex-col items-start gap-1">
      {link && <TextLink href={link.href}>{link.label}</TextLink>}
      {model.beforeOffer && (
        <span>
          {ru.app.chat.room.hiddenShort}{" "}
          <Explain label={t.why} title={t.whyTitle} device={device}>
            <p>{t.whyBody}</p>
          </Explain>
        </span>
      )}
    </span>
  );

  const room = <ChatRoom key={offerId} offerId={offerId} initial={model} device={device} maxLength={CHAT_MAX_LENGTH} maxAttachments={CHAT_MAX_ATTACHMENTS} />;
  return (
    <Stack gap="section">
      <PageTitle title={item?.counterpart ?? t.fallbackTitle} back={{ href: to("/chats"), label: t.back }} lead={lead} />
      {device === "desktop" ? <Narrow>{room}</Narrow> : room}
    </Stack>
  );
}
