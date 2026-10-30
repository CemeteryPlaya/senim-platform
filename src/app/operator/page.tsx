import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isDemoMode, listDisputes, listRegistrationQueue, listStaleRequests } from "@/modules/operator";
import { Alert, Container, PageHeader } from "@/ui";
import { requireOperatorPage } from "./_lib/guard";

const t = ru.operator;

export const metadata: Metadata = { title: t.title };

const SECTIONS = [
  { href: "/operator/executors", label: t.nav.executors, hint: t.nav.executorsHint },
  { href: "/operator/disputes", label: t.nav.disputes, hint: t.nav.disputesHint },
  { href: "/operator/requests", label: t.nav.requests, hint: t.nav.requestsHint },
  { href: "/operator/furniture-types", label: t.nav.types, hint: t.nav.typesHint },
  { href: "/operator/audit", label: t.nav.audit, hint: t.nav.auditHint },
  { href: "/operator/report", label: t.nav.report, hint: t.nav.reportHint },
] as const;

export default async function OperatorHome() {
  const user = await requireOperatorPage();
  const [queue, disputes, stale] = await Promise.all([
    listRegistrationQueue(user),
    listDisputes(user),
    listStaleRequests(user, { hours: 24 }),
  ]);
  const openDisputes = disputes.filter((d) => d.status === "OPEN").length;
  const todo = [
    queue.length > 0 && { href: "/operator/executors", text: t.dashboard.pending(queue.length) },
    openDisputes > 0 && { href: "/operator/disputes", text: t.dashboard.disputes(openDisputes) },
    stale.length > 0 && { href: "/operator/requests", text: t.dashboard.stale(stale.length) },
  ].filter((x): x is { href: string; text: string } => Boolean(x));
  const sections = isDemoMode() ? [...SECTIONS, { href: "/operator/demo", label: t.nav.demo, hint: t.nav.demoHint }] : SECTIONS;

  return (
    <Container>
      <PageHeader title={t.title} description={t.description} />
      <section aria-labelledby="todo" className="mb-8 flex flex-col gap-3">
        <h2 id="todo" className="text-xl font-bold text-ink">
          {t.dashboard.todo}
        </h2>
        {todo.length === 0 ? (
          <Alert tone="success">{t.dashboard.allClear}</Alert>
        ) : (
          <ul className="flex flex-col gap-2">
            {todo.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-control items-center justify-between gap-3 rounded-control bg-warning-soft px-4 font-semibold text-ink no-underline hover:underline"
                >
                  {item.text}
                  <ArrowRight aria-hidden className="size-5 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="sections" className="flex flex-col gap-3">
        <h2 id="sections" className="text-xl font-bold text-ink">
          {t.dashboard.sections}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex h-full flex-col gap-1 rounded-card border border-line bg-surface p-5 no-underline shadow-card hover:border-line-strong"
              >
                <span className="text-lg font-bold text-ink">{s.label}</span>
                <span className="text-base text-ink-soft">{s.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}
