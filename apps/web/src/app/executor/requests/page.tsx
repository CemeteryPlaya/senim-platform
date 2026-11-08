import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import type { IncomingListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Container, EmptyState, FilterChips, PageHeader, StatTiles, type FilterChipItem } from "@/ui";
import { pageUser } from "@/app/requests/_parts/guard";
import { NoAccess } from "@/app/_components/NoAccess";
import { IncomingCard } from "../_parts/IncomingCard";
import { executorSummary } from "../_parts/summary";

const t = ru.requests.incoming;
const x = ru.executor.incoming;
const chip = ru.common.ui.filterChip;

export const metadata: Metadata = { title: t.metaTitle };

type Search = { f?: string; type?: string };

/** Выбранный чип из адреса: раздел (без отклика, прямые) или тип мебели; неизвестное — «Все». */
function selected(sp: Search, list: readonly IncomingListItem[]): { key: string; keep: (r: IncomingListItem) => boolean } {
  if (sp.type && list.some((r) => r.title === sp.type)) return { key: `type:${sp.type}`, keep: (r) => r.title === sp.type };
  if (sp.f === "new") return { key: "new", keep: (r) => r.myOfferStatus === null };
  if (sp.f === "direct") return { key: "direct", keep: (r) => r.mode === "DIRECT" };
  return { key: "all", keep: () => true };
}

/** Чипы с числом заявок; «Мои отклики» — последним, ведёт в свой раздел (макет master-screens). */
function chipsFor(list: readonly IncomingListItem[], current: string): FilterChipItem[] {
  const base = "/executor/requests";
  const count = (keep: (r: IncomingListItem) => boolean) => list.filter(keep).length;
  const types = [...new Set(list.map((r) => r.title))];
  const direct = count((r) => r.mode === "DIRECT");
  const item = (key: string, label: string, n: number, href: string): FilterChipItem => ({ href, label: chip(label, n), active: current === key });
  return [
    item("all", x.chips.all, list.length, base),
    item("new", x.chips.new, count((r) => r.myOfferStatus === null), `${base}?f=new`),
    ...(direct > 0 ? [item("direct", x.chips.direct, direct, `${base}?f=direct`)] : []),
    ...(types.length > 1 ? types.map((type) => item(`type:${type}`, type, count((r) => r.title === type), `${base}?type=${encodeURIComponent(type)}`)) : []),
    { href: "/executor/offers", label: x.myOffers, active: false },
  ];
}

/**
 * Входящие мастера (макет master-screens, экран 1): сводка плитками (на десктопе — ещё заработок за месяц) →
 * чипы → карточки заявок. Тендеры его уровня и прямые запросы к нему; фильтр — в адресе.
 */
export default async function IncomingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await pageUser("EXECUTOR", "/executor/requests");
  if (!user) {
    return <NoAccess description={ru.requests.noAccessExecutor} />;
  }
  const { incoming: list, tiles } = await executorSummary(user);
  const current = selected(sp, list);
  const shown = list.filter(current.keep);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />
      <StatTiles label={ru.executor.stats.label} items={tiles} className="lg:grid-cols-3" />

      {list.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <>
          <FilterChips label={x.chipsLabel} items={chipsFor(list, current.key)} />
          {shown.length === 0 ? (
            <p className="text-base text-muted">{x.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
              {shown.map((r) => (
                <li key={r.id} className="flex">
                  <IncomingCard r={r} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}
