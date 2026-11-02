import type { Metadata } from "next";
import { CalendarClock, ClipboardList, Layers, MessageSquareText, Plus, Send } from "lucide-react";
import { listMyRequests, WIZARD_SCREENS } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, EmptyState, FilterChips, PageHeader, PhotoCard, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { photo } from "@/app/_home/illustration";
import { pageUser } from "./_parts/guard";
import { groupOf, REQUEST_GROUP, REQUEST_GROUPS, REQUEST_TONE } from "./_parts/labels";
import { NoAccess } from "@/app/_components/NoAccess";

const t = ru.requests.my;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<{ status?: string }> };

/**
 * «Мои заявки» (макет 7, «Мои обращения»): чипы разделов с числом заявок и карточки с фото — первое фото
 * помещения или иллюстрация типа мебели. Черновики продолжаются в мастере, отправленные ведут к откликам.
 */
export default async function MyRequestsPage({ searchParams }: Props) {
  const user = await pageUser("CLIENT", "/requests");
  if (!user) {
    return <NoAccess description={ru.requests.noAccess} />;
  }
  const { status } = await searchParams;
  const list = await listMyRequests(user);
  const group = groupOf(status);
  const shown = group === "all" ? list : list.filter((r) => REQUEST_GROUP[r.status] === group);
  const count = (g: (typeof REQUEST_GROUPS)[number]) => list.filter((r) => REQUEST_GROUP[r.status] === g).length;
  const create = (
    <ButtonLink href="/requests/new" icon={<Plus />}>
      {t.create}
    </ButtonLink>
  );

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={t.lead} back={{ href: "/" }} actions={list.length > 0 ? create : undefined} className="pb-0" />
      {list.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={t.emptyTitle} description={t.emptyText} action={create} />
      ) : (
        <>
          <FilterChips
            label={t.filterLabel}
            current={group}
            chips={[
              { key: "all", label: t.filter.all, count: list.length, href: "/requests" },
              // Пустые разделы не показываем: меньше чипов — проще выбор. Выбранный остаётся, даже если опустел.
              ...REQUEST_GROUPS.filter((g) => count(g) > 0 || g === group).map((g) => ({
                key: g,
                label: t.filter[g],
                count: count(g),
                href: `/requests?status=${g}`,
              })),
            ]}
          />
          {shown.length === 0 ? (
            <EmptyState
              icon={<ClipboardList />}
              title={t.filterEmptyTitle}
              description={t.filterEmptyText}
              action={
                <ButtonLink href="/requests" variant="secondary">
                  {t.showAll}
                </ButtonLink>
              }
            />
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
              {shown.map((r) => {
                const draft = r.status === "DRAFT";
                const title = ru.requests.requestTitle(r.number, r.title);
                const meta = draft
                  ? [{ icon: <Layers />, text: t.draftProgress(Math.min(r.wizardStep, WIZARD_SCREENS.length), WIZARD_SCREENS.length) }]
                  : [
                      ...(r.segment ? [{ icon: <Layers />, text: SEGMENT_NAMES[r.segment] }] : []),
                      ...(r.mode === "DIRECT" ? [{ icon: <Send />, text: ru.requests.mode.DIRECT }] : []),
                      { icon: <MessageSquareText />, text: t.offers(r.offersCount) },
                      {
                        icon: <CalendarClock />,
                        text: (
                          <>
                            {t.created} <DateText value={r.publishedAt ?? r.createdAt} format="relative" />
                          </>
                        ),
                      },
                    ];
                return (
                  <PhotoCard
                    as="li"
                    key={r.id}
                    layout="row"
                    titleAs="h2"
                    href={draft ? `/requests/new?draft=${r.id}` : `/requests/${r.id}`}
                    image={r.cover ?? photo(r.title)}
                    title={title}
                    badge={<StatusBadge tone={REQUEST_TONE[r.status]}>{ru.requests.status[r.status]}</StatusBadge>}
                    meta={meta}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}
