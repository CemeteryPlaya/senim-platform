import type { Metadata } from "next";
import { CalendarClock, MapPin, Ruler } from "lucide-react";
import { ru } from "@/i18n/ru";
import { requireUserPage } from "@/modules/identity";
import { listMySiteMeasurements } from "@/modules/requests";
import { Container, EmptyState, FilterChips, PageHeader, PhotoCard, StatusBadge, formatDateTime } from "@/ui";
import { photo } from "@/app/_home/illustration";

const t = ru.requests.pre.measurer;
const x = ru.executor.measurer;

export const metadata: Metadata = { title: t.metaTitle };

const GROUPS = ["assigned", "done"] as const;
type Group = (typeof GROUPS)[number];

/** Замерщик площадки (ADR-005): назначенные оператором замеры карточками с фото, чипы «Назначены / Выполнены». */
export default async function MeasurerPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const user = await requireUserPage("/measurer", "MEASURER");
  const rows = await listMySiteMeasurements(user);
  const groupOf = (m: (typeof rows)[number]): Group => (m.status === "DONE" ? "done" : "assigned");
  const count = (g: Group) => rows.filter((m) => groupOf(m) === g).length;
  const show: Group = GROUPS.find((g) => g === sp.show) ?? (count("assigned") > 0 || count("done") === 0 ? "assigned" : "done");
  const shown = rows.filter((m) => groupOf(m) === show);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={t.lead} className="pb-0" />
      {rows.length === 0 ? (
        <EmptyState icon={<Ruler />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <>
          <FilterChips
            label={x.chipsLabel}
            current={show}
            chips={GROUPS.map((g) => ({ key: g, label: x.chips[g], count: count(g), href: `/measurer?show=${g}` }))}
          />
          {shown.length === 0 ? (
            <p className="rounded-card border border-line bg-surface p-5 text-base text-ink-soft shadow-card">{x.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
              {shown.map((m) => {
                const done = m.status === "DONE";
                return (
                  <PhotoCard
                    key={m.id}
                    as="li"
                    layout="row"
                    href={`/measurer/${m.id}`}
                    image={photo(m.request.title)}
                    title={ru.requests.requestTitle(m.request.number, m.request.title)}
                    titleAs="h2"
                    badge={<StatusBadge tone={done ? "success" : "accent"}>{done ? t.done : t.assigned}</StatusBadge>}
                    meta={[
                      { icon: <MapPin />, text: m.request.address ?? m.request.city },
                      {
                        icon: <CalendarClock />,
                        text: done && m.doneAt ? x.doneAt(formatDateTime(m.doneAt)) : x.assignedAt(formatDateTime(m.assignedAt)),
                      },
                    ]}
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
