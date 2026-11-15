import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { BackLink, Explain, PageTitle, TextLink } from "@/kit";
import { CHAT_MAX_ATTACHMENTS, CHAT_MAX_LENGTH, chatSideOf, getChat, listChats } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireParty, switchRoleTo } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";
import { ChatPanes } from "../_parts/ChatList";
import { chatHref, chatRoomModel, chatRows, contextLink, contextOf, counterpartOf } from "../_parts/chat-view";
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
  const counterpart = counterpartOf(view.counterpart, side);
  const back = { href: to("/chats"), label: t.back };

  const lead = (
    <span className="flex flex-col items-start gap-1">
      <TextLink href={link.href}>{link.label}</TextLink>
      {model.beforeOffer && (
        <span>
          {t.hiddenShort}{" "}
          <Explain label={t.why} title={t.whyTitle} device={device}>
            <p>{t.whyBody}</p>
          </Explain>
        </span>
      )}
    </span>
  );

  const room = (
    <ChatRoom key={offerId} offerId={offerId} initial={model} side={side} device={device} maxLength={CHAT_MAX_LENGTH} maxAttachments={CHAT_MAX_ATTACHMENTS} />
  );

  if (device === "desktop") {
    // Компьютер — две панели (общий каркас ChatPanes с экраном списка): слева «Чаты» и список (открытый отмечен), справа
    // заголовок и переписка: заголовок не сжимается, лента — flex-1 со своей прокруткой, поле ввода последним. Обёртка
    // ленты без min-h-0: меньше ленты chat-min с полем она не сожмётся — тогда прокручивается правая панель (низкое окно,
    // крупный шрифт), а поле прилипает к её низу (Chat fill).
    const rows = chatRows(await listChats(user), new Date(), side);
    return (
      <ChatPanes rows={rows} side={side} current={offerId} heading={<h2 className="text-balance text-title text-ink">{ru.app.chat.list.title}</h2>}>
        <div className="shrink-0">
          <PageTitle title={counterpart} back={back} lead={lead} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">{room}</div>
      </ChatPanes>
    );
  }

  // Телефон — как большой заголовок iOS: к верхнему краю прилипает только короткая шапка-стекло («‹ Чаты» и имя
  // собеседника, оно проявляется, когда большой заголовок ушёл под шапку — compact-title), а большой заголовок, ссылка
  // «к чему относится» и «Почему?» прокручиваются вместе с лентой. Длинная переписка открывается внизу — видна короткая
  // шапка (~84 px), а не вся (~240 px). На стекле шапки — только ink и glass-secondary (BackLink onGlass).
  return (
    <div className="flex min-w-0 flex-col gap-stack-section">
      <div data-chat-bar className="sticky-head glass-bar flex items-center gap-3">
        <BackLink {...back} onGlass />
        <span aria-hidden className="compact-title min-w-0 flex-1 truncate text-headline text-ink">
          {counterpart}
        </span>
      </div>
      <PageTitle title={counterpart} lead={lead} />
      <div className="flex min-w-0 flex-1 flex-col">{room}</div>
    </div>
  );
}
