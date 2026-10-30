import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import { listMyRequests, WIZARD_SCREENS } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { pageUser } from "./_parts/guard";
import { REQUEST_TONE } from "./_parts/labels";

const t = ru.requests.my;

export const metadata: Metadata = { title: t.metaTitle };

/** «Мои заявки»: черновики продолжаются в мастере, отправленные ведут к откликам. */
export default async function MyRequestsPage() {
  const user = await pageUser("CLIENT", "/requests");
  if (!user) {
    return (
      <Container className="pt-6">
        <EmptyState title={ru.common.errors.forbidden} description={ru.requests.noAccess} />
      </Container>
    );
  }
  const list = await listMyRequests(user);
  const create = (
    <ButtonLink href="/requests/new" icon={<Plus />}>
      {t.create}
    </ButtonLink>
  );

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.lead} actions={list.length > 0 ? create : undefined} />
      {list.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title={t.emptyTitle} description={t.emptyText} action={create} />
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((r) => {
            const draft = r.status === "DRAFT";
            return (
              <li key={r.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-ink">{ru.requests.requestTitle(r.number, r.title)}</h2>
                    <StatusBadge tone={REQUEST_TONE[r.status]}>{ru.requests.status[r.status]}</StatusBadge>
                    {r.mode === "DIRECT" && <StatusBadge tone="accent">{ru.requests.mode.DIRECT}</StatusBadge>}
                  </div>
                  <p className="text-base text-muted">
                    {draft ? (
                      t.draftProgress(Math.min(r.wizardStep, WIZARD_SCREENS.length), WIZARD_SCREENS.length)
                    ) : (
                      <>
                        {r.segment && <span className="mr-4">{SEGMENT_NAMES[r.segment]}</span>}
                        <span className="mr-4">{t.offers(r.offersCount)}</span>
                        <span>
                          {t.created} <DateText value={r.publishedAt ?? r.createdAt} format="relative" />
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <ButtonLink href={draft ? `/requests/new?draft=${r.id}` : `/requests/${r.id}`} variant="secondary" className="shrink-0">
                  {draft ? t.continueDraft : t.open}
                  <span className="sr-only">: {ru.requests.requestTitle(r.number, r.title)}</span>
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
