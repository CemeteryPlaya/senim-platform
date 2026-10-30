import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { listIncomingRequests } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, DateText, EmptyState, PageHeader, StatusBadge, cn } from "@/ui";
import { SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { pageUser } from "@/app/requests/_parts/guard";
import { OFFER_TONE } from "@/app/requests/_parts/labels";

const t = ru.requests.incoming;

export const metadata: Metadata = { title: t.metaTitle };

const FILTERS = ["all", "TENDER", "DIRECT"] as const;

/** Входящие исполнителя: тендеры его уровня и прямые запросы к нему. */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/requests");
  if (!user) {
    return (
      <Container className="pt-6">
        <EmptyState title={ru.common.errors.forbidden} description={ru.requests.noAccessExecutor} />
      </Container>
    );
  }
  const mode = sp.mode === "TENDER" || sp.mode === "DIRECT" ? sp.mode : undefined;
  const list = await listIncomingRequests(user, { mode });
  const current = mode ?? "all";

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={t.lead} back={{ href: "/" }} />
      <nav aria-label={t.filterLabel}>
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={f === "all" ? "/executor/requests" : `/executor/requests?mode=${f}`}
                aria-current={f === current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-control-sm items-center rounded-full border px-4 text-base font-semibold no-underline",
                  f === current ? "border-primary bg-accent-soft text-primary" : "border-line-strong bg-surface text-ink hover:bg-sunken",
                )}
              >
                {t.filter[f]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {list.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((r) => {
            const title = ru.requests.requestTitle(r.number, r.title);
            return (
              <li key={r.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-ink">{title}</h2>
                    {r.mode === "DIRECT" && <StatusBadge tone="accent">{ru.requests.mode.DIRECT}</StatusBadge>}
                    {r.myOfferStatus && (
                      <StatusBadge tone={OFFER_TONE[r.myOfferStatus]}>
                        {t.myOffer}: {ru.requests.offerStatus[r.myOfferStatus].toLowerCase()}
                      </StatusBadge>
                    )}
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-base">
                    {r.segment && (
                      <div className="flex gap-2">
                        <dt className="text-muted">{ru.requests.facts.segment}</dt>
                        <dd className="text-ink">{SEGMENT_NAMES[r.segment]}</dd>
                      </div>
                    )}
                    {r.style && (
                      <div className="flex gap-2">
                        <dt className="text-muted">{ru.requests.facts.style}</dt>
                        <dd className="text-ink">{STYLES[r.style as StyleKey]?.name ?? r.style}</dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="text-muted">{ru.requests.facts.city}</dt>
                      <dd className="text-ink">{r.city}</dd>
                    </div>
                    {r.publishedAt && (
                      <div className="flex gap-2">
                        <dt className="text-muted">{t.published}</dt>
                        <dd className="text-ink">
                          <DateText value={r.publishedAt} format="relative" />
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p className="text-base text-muted">{t.offers(r.offersCount)}</p>
                </div>
                <ButtonLink href={`/executor/requests/${r.id}`} variant="secondary" className="shrink-0" aria-label={ru.common.ui.actionFor(t.open, title)}>
                  {t.open}
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
