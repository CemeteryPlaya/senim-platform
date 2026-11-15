import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Explain, PageTitle, TextLink } from "@/kit";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, chatSideOf, getChat } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireParty, switchRoleTo } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";
import { chatHref, chatRoomModel, contextLink, contextOf, counterpartOf } from "../_parts/chat-view";
import { ChatRoom } from "./ChatRoom";

const t = ru.app.chat.room;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ offerId: string }> };

/** Сторона отклика модуля (`chatSideOf`) — роль. */
const ROLE_OF = { client: "CLIENT", executor: "EXECUTOR" } as const satisfies Record<"client" | "executor", DealSide>;

/**
 * Диалог стороны в активной роли (`requireParty`) по одному предложению: покупатель — с мастером, мастер — с покупателем.
 * Шапка: «Назад: Чаты», собеседник (покупателю — то, что отдаёт модуль: «Исполнитель №N» до оферты, имя после; мастеру —
 * «Покупатель»), ссылка «к чему относится» по стороне (сделка; до неё — предложение покупателя или заявка мастера). Экран —
 * лента и поле ввода; главного действия и дока нет, поле — последний элемент. Чужой и несуществующий диалог — 404 (модуль:
 * NOT_FOUND).
 * Человек с двумя ролями: диалог, где он сторона в другой своей выданной роли (по уведомлению, по ссылке), — переключение
 * роли с возвратом сюда (`chatSideOf` — сторона по человеку, а не по роли). После переключения активная роль совпадает со
 * стороной диалога, поэтому петли нет.
 */
export default async function ChatPage({ params }: Props) {
  const { offerId } = await params;
  const here = chatHref(offerId);
  const { user, side } = await requireParty(here);
  const own = await chatSideOf(user, offerId);
  if (own && ROLE_OF[own.side] !== side && user.roles.includes(ROLE_OF[own.side])) redirect(switchRoleTo(ROLE_OF[own.side], here));
  const view = await getChat(user, offerId, { attachments: true }).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const model = chatRoomModel(view, new Date(), side);
  const device = await getDevice();
  const link = contextLink(contextOf(view), view.title, side);

  const lead = (
    <span className="flex flex-col items-start gap-1">
      <TextLink href={link.href}>{link.label}</TextLink>
      {model.beforeOffer && (
        <span>
          {t.hiddenShort}{" "}
          <Explain label={t.why} title={t.whyTitle} device={device} onGlass={device === "mobile"}>
            <p>{t.whyBody}</p>
          </Explain>
        </span>
      )}
    </span>
  );

  const room = (
    <ChatRoom key={offerId} offerId={offerId} initial={model} side={side} device={device} maxLength={CHAT_MAX_LENGTH} maxAttachments={CHAT_MAX_ATTACHMENTS} />
  );
  // Компьютер: колонка на высоту окна за вычетом шапки (screen-fill): заголовок не сжимается, лента — flex-1 со своей
  // прокруткой, поле ввода последним. Телефон: прокручивается страница, а шапка («Назад: Чаты», собеседник, «Почему?»)
  // закреплена у верхнего края (sticky-head) — длинная переписка открывается внизу, и шапка не уезжает.
  return (
    <div className="flex min-w-0 flex-col gap-stack-section desktop:screen-fill">
      <div className="mobile:sticky-head mobile:glass-bar desktop:shrink-0">
        {/* На телефоне шапка — стекло (glass-bar): на нём только ink и glass-secondary (onGlass), без muted и accent. */}
        <PageTitle
          title={counterpartOf(view.counterpart, side)}
          back={{ href: to("/chats"), label: t.back }}
          lead={lead}
          onGlass={device === "mobile"}
        />
      </div>
      <div className="flex min-w-0 flex-col mobile:flex-1 desktop:min-h-0 desktop:max-w-narrow desktop:flex-1">{room}</div>
    </div>
  );
}
