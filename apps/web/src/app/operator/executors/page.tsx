import type { Metadata } from "next";
import Link from "next/link";
import { Plus, UserCheck, Users } from "lucide-react";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { listExecutors, listRegistrationQueue } from "@/modules/operator";
import { ButtonLink, Container, DateText, EmptyState, FilterChips, PageHeader, SectionTitle, StatusBadge, type Tone } from "@/ui";
import { COL_MID, COL_WIDE, DataTable, TD, TH, TH_ROW } from "../_components/DataTable";
import { LIST_GRID, ListCard } from "../_components/ListCard";
import { param, requireOperatorPage } from "../_lib/guard";

const t = ru.operator;
const e = t.executors;

export const metadata: Metadata = { title: e.title };

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
const STATUS_TONE: Record<(typeof STATUSES)[number], Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" };
const statusFilter = z.enum(STATUSES).optional().catch(undefined);
const chip = ru.common.ui.filterChip;

type Row = Awaited<ReturnType<typeof listExecutors>>[number];
const col = e.columns;

/** Все исполнители таблицей: на десктопе — строка на исполнителя, на телефоне таблица прокручивается в своей области. */
function ExecutorTable({ rows }: { rows: readonly Row[] }) {
  return (
    <DataTable caption={e.allTitle} hideCaption>
      <thead>
        <tr>
          {[col.executor, col.registration, col.segment, col.legal, col.registered].map((label) => (
            <th key={label} scope="col" className={TH}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}>
            <th scope="row" className={`${TH_ROW} ${COL_WIDE}`}>
              <Link href={`/operator/executors/${x.id}`} className="font-semibold break-words text-primary underline">
                {`${ru.common.executorLabel(x.publicNumber)}: ${x.legalName}`}
              </Link>
            </th>
            <td className={TD}>
              <StatusBadge tone={STATUS_TONE[x.status]}>{t.registration[x.status]}</StatusBadge>
            </td>
            <td className={TD}>
              <StatusBadge tone={x.segment ? "accent" : "neutral"}>{x.segment ? t.segments[x.segment] : t.noSegment}</StatusBadge>
            </td>
            <td className={`${TD} text-ink-soft ${COL_MID}`}>{`${t.legalForms[x.legalForm]}, ${t.binIinMasked(x.binIinLast4)}`}</td>
            <td className={`${TD} whitespace-nowrap text-ink-soft`}>
              <DateText value={x.createdAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function ExecutorItem({ x }: { x: Row }) {
  return (
    <ListCard
      href={`/operator/executors/${x.id}`}
      title={`${ru.common.executorLabel(x.publicNumber)}: ${x.legalName}`}
      badges={
        <>
          <StatusBadge tone={STATUS_TONE[x.status]}>{t.registration[x.status]}</StatusBadge>
          <StatusBadge tone={x.segment ? "accent" : "neutral"}>{x.segment ? t.segments[x.segment] : t.noSegment}</StatusBadge>
        </>
      }
      meta={[
        `${t.legalForms[x.legalForm]}, ${t.binIinMasked(x.binIinLast4)}`,
        <>
          {e.registered} <DateText value={x.createdAt} />
        </>,
      ]}
    />
  );
}

export default async function ExecutorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage("/operator/executors");
  const status = statusFilter.parse(param((await searchParams).status));
  const [queue, all] = await Promise.all([listRegistrationQueue(user), listExecutors(user)]);
  const shown = status ? all.filter((x) => x.status === status) : all;
  const count = (s: (typeof STATUSES)[number]) => all.filter((x) => x.status === s).length;

  return (
    <Container className="pb-10">
      <PageHeader
        title={e.title}
        back={{ href: "/operator", label: t.backToPanel }}
        actions={
          <ButtonLink href="/operator/executors/new" variant="secondary" icon={<Plus />}>
            {e.add}
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-10">
        <section aria-labelledby="queue" className="flex flex-col gap-4">
          <SectionTitle id="queue" title={`${e.queueTitle} (${queue.length})`} />
          {queue.length === 0 ? (
            <EmptyState icon={<UserCheck />} title={e.queueEmpty} description={e.queueEmptyHint} titleAs="h3" />
          ) : (
            <ul className={LIST_GRID}>
              {queue.map((x) => (
                <ExecutorItem key={x.id} x={x} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="all" className="flex flex-col gap-4">
          <SectionTitle id="all" title={e.allTitle} />
          <FilterChips
            label={e.filterLabel}
            items={[
              { label: chip(e.filter.all, all.length), href: "/operator/executors", active: !status },
              ...STATUSES.map((s) => ({ label: chip(e.filter[s], count(s)), href: `/operator/executors?status=${s}`, active: s === status })),
            ]}
          />
          {shown.length === 0 ? (
            <EmptyState icon={<Users />} title={e.filterEmpty} description={e.filterEmptyHint} titleAs="h3" />
          ) : (
            <ExecutorTable rows={shown} />
          )}
        </section>
      </div>
    </Container>
  );
}
