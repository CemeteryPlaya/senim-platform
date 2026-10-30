import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { listExecutors, listRegistrationQueue } from "@/modules/operator";
import { Button, ButtonLink, Container, DateText, EmptyState, PageHeader, Select, StatusBadge, type Tone } from "@/ui";
import { param, requireOperatorPage } from "../_lib/guard";

const t = ru.operator;
const e = t.executors;

export const metadata: Metadata = { title: e.title };

const STATUS_TONE: Record<"PENDING" | "APPROVED" | "REJECTED", Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" };
const statusFilter = z.enum(["PENDING", "APPROVED", "REJECTED"]).optional().catch(undefined);

type Row = Awaited<ReturnType<typeof listExecutors>>[number];

function ExecutorItem({ x }: { x: Row }) {
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Link href={`/operator/executors/${x.id}`} className="text-lg font-bold break-words text-ink">
          {ru.common.executorLabel(x.publicNumber)}: {x.legalName}
        </Link>
        <p className="text-base text-ink-soft">
          {t.legalForms[x.legalForm]}, {t.binIinMasked(x.binIinLast4)}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusBadge tone={STATUS_TONE[x.status]}>{t.registration[x.status]}</StatusBadge>
          <StatusBadge tone={x.segment ? "accent" : "neutral"}>{x.segment ? t.segments[x.segment] : t.noSegment}</StatusBadge>
          <span>
            {e.registered} <DateText value={x.createdAt} />
          </span>
        </p>
      </div>
      <ButtonLink href={`/operator/executors/${x.id}`} variant="secondary" className="self-start sm:self-center">
        {e.open}
      </ButtonLink>
    </li>
  );
}

export default async function ExecutorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireOperatorPage();
  const status = statusFilter.parse(param((await searchParams).status));
  const [queue, all] = await Promise.all([listRegistrationQueue(user), listExecutors(user, { status })]);

  return (
    <Container>
      <PageHeader
        title={e.title}
        description={e.description}
        back={{ href: "/operator", label: t.backToPanel }}
        actions={
          <ButtonLink href="/operator/executors/new" icon={<Plus />}>
            {e.add}
          </ButtonLink>
        }
      />

      <section aria-labelledby="queue" className="mb-10 flex flex-col gap-3">
        <h2 id="queue" className="text-xl font-bold text-ink">
          {e.queueTitle} ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <EmptyState title={e.queueEmpty} description={e.queueEmptyHint} titleAs="h3" />
        ) : (
          <ul className="rounded-card border border-line bg-surface px-5">
            {queue.map((x) => (
              <ExecutorItem key={x.id} x={x} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="all" className="flex flex-col gap-3">
        <h2 id="all" className="text-xl font-bold text-ink">
          {e.allTitle}
        </h2>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Select
            label={e.filterStatus}
            name="status"
            defaultValue={status ?? ""}
            options={[
              { value: "", label: e.filterAll },
              ...(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => ({ value: s, label: t.registration[s] })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {e.apply}
          </Button>
        </form>
        <ul className="rounded-card border border-line bg-surface px-5">
          {all.map((x) => (
            <ExecutorItem key={x.id} x={x} />
          ))}
        </ul>
      </section>
    </Container>
  );
}
