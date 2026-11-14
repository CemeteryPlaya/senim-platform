import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Explain, PageTitle, TextLink } from "@/kit";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, getChat } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireBuyer } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { chatHref, chatRoomModel, contextLink, contextOf } from "../_parts/chat-view";
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
  const view = await getChat(user, offerId, { attachments: true }).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const model = chatRoomModel(view);
  const device = await getDevice();
  const link = contextLink(contextOf(view), view.title);

  const lead = (
    <span className="flex flex-col items-start gap-1">
      <TextLink href={link.href}>{link.label}</TextLink>
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
  // Компьютер: колонка на высоту окна за вычетом шапки (screen-fill): заголовок не сжимается, лента — flex-1 со своей
  // прокруткой, поле ввода последним. Телефон: обычный поток, прокручивается страница.
  return (
    <div className="flex min-w-0 flex-col gap-stack-section desktop:screen-fill">
      <div className="desktop:shrink-0">
        <PageTitle title={view.counterpart} back={{ href: to("/chats"), label: t.back }} lead={lead} />
      </div>
      <div className="flex min-w-0 flex-col mobile:flex-1 desktop:min-h-0 desktop:max-w-narrow desktop:flex-1">{room}</div>
    </div>
  );
}
