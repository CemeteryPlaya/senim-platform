import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ruler } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isEnabled } from "@/platform/features";
import { requireUserPage } from "@/modules/identity";
import { listMySiteMeasurements } from "@/modules/requests";
import { Container, EmptyState, FilterChips, PageHeader, RequestCard, StatusBadge, formatDateTime } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";

const t = ru.requests.pre.measurer;
const x = ru.executor.measurer;

export const metadata: Metadata = { title: t.metaTitle };

const GROUPS = ["assigned", "done"] as const;
type Group = (typeof GROUPS)[number];

/**
 * Замерщик площадки (ADR-005) в стиле «B + A»: чипы «Назначены · N / Выполнены · N» и замеры карточками заявки
 * (RequestCard: иллюстрация вида мебели, статус меткой, адрес выезда и время). Действие — на экране замера.
 */
export default async function MeasurerPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  // Замерщик площадки — сценарий 2 (флаг preContractFlows, решение 2.2.9).
  if (!isEnabled("preContractFlows")) notFound();
  const sp = await searchParams;
  const user = await requireUserPage("/measurer", "MEASURER");
  const rows = await listMySiteMeasurements(user);
  const groupOf = (m: (typeof rows)[number]): Group => (m.status === "DONE" ? "done" : "assigned");
  const count = (g: Group) => rows.filter((m) => groupOf(m) === g).length;
  const show: Group = GROUPS.find((g) => g === sp.show) ?? (count("assigned") > 0 || count("done") === 0 ? "assigned" : "done");
  const shown = rows.filter((m) => groupOf(m) === show);

  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} className="pb-0" />
      {rows.length === 0 ? (
        <EmptyState icon={<Ruler />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <>
          <FilterChips
            label={x.chipsLabel}
            items={GROUPS.map((g) => ({ label: ru.requests.my.filterChip(x.chips[g], count(g)), href: `/measurer?show=${g}`, active: g === show }))}
          />
          {shown.length === 0 ? (
            <p className="text-base text-muted">{x.emptyFilter}</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(24rem,100%),1fr))] gap-3">
              {shown.map((m) => {
                const done = m.status === "DONE";
                return (
                  <li key={m.id} className="flex">
                    <RequestCard
                      className="flex-1"
                      href={`/measurer/${m.id}`}
                      thumbUrl={illustrationFor(m.request.title)}
                      title={ru.requests.requestTitle(m.request.number, m.request.title)}
                      isNew={false}
                      badges={<StatusBadge tone={done ? "success" : "accent"}>{done ? t.done : t.assigned}</StatusBadge>}
                      meta={[
                        m.request.address ?? m.request.city,
                        done && m.doneAt ? x.doneAt(formatDateTime(m.doneAt)) : x.assignedAt(formatDateTime(m.assignedAt)),
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Container>
  );
}
