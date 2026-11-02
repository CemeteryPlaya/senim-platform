import type { Metadata } from "next";
import Link from "next/link";
import { Ruler } from "lucide-react";
import { ru } from "@/i18n/ru";
import { requireUserPage } from "@/modules/identity";
import { listMySiteMeasurements } from "@/modules/requests";
import { Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";

const t = ru.requests.pre.measurer;

export const metadata: Metadata = { title: t.metaTitle };

/** Замерщик площадки (ADR-005): назначенные оператором замеры, сначала невыполненные. */
export default async function MeasurerPage() {
  const user = await requireUserPage("/measurer", "MEASURER");
  const rows = await listMySiteMeasurements(user);
  return (
    <Container className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} description={t.lead} />
      {rows.length === 0 ? (
        <EmptyState icon={<Ruler />} title={t.emptyTitle} description={t.emptyText} />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={m.status === "DONE" ? "success" : "accent"}>{m.status === "DONE" ? t.done : t.assigned}</StatusBadge>
                <span className="text-sm text-muted">
                  <DateText value={m.doneAt ?? m.assignedAt} format="dateTime" />
                </span>
              </p>
              <h2 className="text-lg font-bold text-ink">
                <Link href={`/measurer/${m.id}`} className="text-ink underline-offset-4 hover:underline">
                  {ru.requests.requestTitle(m.request.number, m.request.title)}
                </Link>
              </h2>
              <p className="text-base text-ink-soft">{[m.request.city, m.request.address].filter(Boolean).join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
