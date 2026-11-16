import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, PageTitle, Stack, TextLink } from "@/kit";
import { listChats } from "@/modules/companies";
import { listMyRequests } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { masterStatusOf, pageHref, requireParty } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { ChatList, ChatPanes } from "../_parts/ChatList";
import { chatRows } from "../_parts/chat-view";

const t = ru.app.chat.list;
const tm = ru.app.masterDeal.chat.list;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Чаты» стороны в активной роли (`requireParty`): покупателю — диалоги по предложениям на свои заявки, мастеру — по своим
 * предложениям; свежие сверху, диалоги другой роли сюда не попадают (модуль выбирает по активной роли). Собеседник — как
 * называет модуль («Исполнитель №N» до оферты, имя после), мастеру — «Покупатель»; последнее сообщение уже замаскировано
 * модулем. Модуль не отдаёт признак «непрочитано», поэтому его на экране нет. Пусто — обучающий экран без кнопки и ссылка:
 * покупателю с заявками — «Мои заявки», одобренному мастеру — «Заявки».
 * Компьютер — две панели, как в «Сообщениях» (разбор 3.9): список 360 px слева и место переписки справа (пока диалог не
 * выбран — подсказка); телефон — список во всю ширину.
 */
export default async function ChatsPage() {
  const { user, side } = await requireParty(pageHref("/chats"));
  const rows = chatRows(await listChats(user), new Date(), side);
  const device = await getDevice();
  const title = <PageTitle title={t.title} />;

  if (rows.length === 0) {
    const empty =
      side === "EXECUTOR"
        ? { title: tm.emptyTitle, body: tm.emptyBody, link: masterStatusOf(user) === "approved" ? { href: to("/executor/requests"), label: tm.toRequests } : null }
        : { title: t.emptyTitle, body: t.emptyBody, link: (await listMyRequests(user)).length > 0 ? { href: to("/requests"), label: t.myRequests } : null };
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={empty.title} body={empty.body} />
        {empty.link && <TextLink href={empty.link.href}>{empty.link.label}</TextLink>}
      </Stack>
    );
  }

  if (device === "desktop") {
    return (
      <ChatPanes rows={rows} side={side} heading={title}>
        <Card className="flex flex-1 items-center justify-center">
          <p className="max-w-narrow text-center text-body text-muted">{t.pick}</p>
        </Card>
      </ChatPanes>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <ChatList rows={rows} side={side} />
    </Stack>
  );
}
