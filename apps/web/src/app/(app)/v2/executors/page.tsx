import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Columns, EmptyState, PageTitle, Pagination, Stack, WorkCard } from "@/kit";
import { listExecutors } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { pageHref, userPastOnboarding } from "../../_shell/auth";
import { cardMedia } from "../_parts/work-card";
import { executorsListView, parseExecutorsSearch } from "./_parts/list-view";
import { inviteContext } from "./_parts/load";

const t = ru.app.guest.executors;

export const metadata: Metadata = { title: t.title };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Общий список мастеров: карточка — фото работы, метка мастера (ADR-006), уровень, оценка, число сделок и доля успешных;
 * ведёт на профиль мастера. Открыт гостю, как профиль мастера и каталог. Порядок задаёт модуль. Главного действия нет; в
 * пустых состояниях оно одно — в `EmptyState`. С `?request=<id>` своей открытой заявки (путь ТЗ, на всех мастеров) список
 * открыт для неё: подзаголовок с номером и «Назад» к заявке; чужая или неподходящая заявка — обычный список без ошибки
 * (без подзаголовка). На телефоне у карточки без фото пустой рамки нет (`cardMedia`).
 */
export default async function ExecutorsPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await userPastOnboarding(pageHref("/executors", params));
  const search = parseExecutorsSearch(params);
  const [result, invite, device] = await Promise.all([listExecutors({ page: search.page }), inviteContext(user, search.requestId), getDevice()]);
  const view = executorsListView(result, search, invite);

  return (
    <Stack gap="section">
      <PageTitle title={t.title} {...(view.lead ? { lead: view.lead } : {})} {...(view.back ? { back: view.back } : {})} />
      {view.empty && <EmptyState title={view.empty.title} body={view.empty.body} action={view.empty.action} />}
      {view.cards.length > 0 && (
        <Columns count={3}>
          {view.cards.map((card, index) => (
            <WorkCard
              key={card.key}
              href={card.href}
              title={card.title}
              meta={card.meta}
              byline={card.byline}
              media={cardMedia(view.media, card, device)}
              headingLevel={2}
              priority={index < (device === "desktop" ? 3 : 1)}
              {...(card.photo ? { photo: card.photo } : {})}
            />
          ))}
        </Columns>
      )}
      {view.state === "results" && <Pagination page={view.page} pageCount={view.pageCount} hrefFor={view.hrefFor} label={t.paginationLabel} />}
    </Stack>
  );
}
