import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, ChevronRight, FlaskConical, Inbox, Ruler, Scale, ScrollText, Sofa, TriangleAlert, UserCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isDemoMode, listDisputes, listRegistrationQueue, listStaleRequests } from "@/modules/operator";
import { Alert, Container, LinkList, PageHeader, SectionTitle, Stat, type LinkListItem } from "@/ui";
import { requireOperatorPage } from "./_lib/guard";

const t = ru.operator;
const d = t.dashboard;

export const metadata: Metadata = { title: t.title };

/**
 * Главная оператора по макету кабинета (стр. 12): показатели — только настоящие числа, ведут в разделы;
 * что требует внимания — жёлтые плашки; разделы — меню со значками, зелёный пункт — первый, где есть дела.
 */
export default async function OperatorHome() {
  const user = await requireOperatorPage("/operator");
  const [queue, disputes, stale] = await Promise.all([
    listRegistrationQueue(user),
    listDisputes(user),
    listStaleRequests(user, { hours: 24 }),
  ]);
  const openDisputes = disputes.filter((x) => x.status === "OPEN").length;
  const todo = [
    queue.length > 0 && { href: "/operator/executors", text: d.pending(queue.length) },
    openDisputes > 0 && { href: "/operator/disputes", text: d.disputes(openDisputes) },
    stale.length > 0 && { href: "/operator/requests", text: d.stale(stale.length) },
  ].filter((x): x is { href: string; text: string } => Boolean(x));

  const sections: LinkListItem[] = [
    { href: "/operator/executors", label: t.nav.executors, description: t.nav.executorsHint, icon: <UserCheck />, meta: queue.length || undefined },
    { href: "/operator/disputes", label: t.nav.disputes, description: t.nav.disputesHint, icon: <Scale />, meta: openDisputes || undefined },
    { href: "/operator/requests", label: t.nav.requests, description: t.nav.requestsHint, icon: <Inbox />, meta: stale.length || undefined },
    { href: "/operator/furniture-types", label: t.nav.types, description: t.nav.typesHint, icon: <Sofa /> },
    { href: "/operator/materials", label: ru.materials.nav, description: ru.materials.navHint, icon: <Ruler /> },
    { href: "/operator/audit", label: t.nav.audit, description: t.nav.auditHint, icon: <ScrollText /> },
    { href: "/operator/report", label: t.nav.report, description: t.nav.reportHint, icon: <ChartColumn /> },
    ...(isDemoMode() ? [{ href: "/operator/demo", label: t.nav.demo, description: t.nav.demoHint, icon: <FlaskConical /> }] : []),
  ];
  // Главный пункт — первый раздел, где ждут дела; если дел нет — «Исполнители».
  const main = todo[0]?.href ?? "/operator/executors";
  const items = sections.map((s) => ({ ...s, highlight: s.href === main }));

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/" }} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <ul aria-label={d.stats} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-3">
            <li className="flex">
              <Stat className="flex-1" href="/operator/executors" icon={<UserCheck />} value={queue.length} label={d.statPending} />
            </li>
            <li className="flex">
              <Stat className="flex-1" href="/operator/disputes" icon={<Scale />} value={openDisputes} label={d.statDisputes} />
            </li>
            <li className="col-span-full flex sm:col-span-1">
              <Stat className="flex-1" href="/operator/requests" icon={<Inbox />} value={stale.length} label={d.statStale} />
            </li>
          </ul>
          <section aria-labelledby="todo" className="flex min-w-0 flex-col gap-3">
            <SectionTitle id="todo" title={d.todo} />
            {todo.length === 0 ? (
              <Alert tone="accent" title={d.allClear}>
                {d.allClearHint}
              </Alert>
            ) : (
              <ul className="flex flex-col gap-3">
                {todo.map((item) => (
                  <li key={item.href}>
                    <TodoLink href={item.href} text={item.text} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <nav aria-labelledby="sections" className="flex min-w-0 flex-col gap-3">
          <SectionTitle id="sections" title={d.sections} />
          <LinkList items={items} />
        </nav>
      </div>
    </Container>
  );
}

/** Жёлтая плашка-ссылка «1 открытый спор →»: значок, текст, стрелка; вся плашка нажимается. */
function TodoLink({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-control items-center gap-3 rounded-card bg-warning-soft px-4 py-3 text-base font-semibold text-ink no-underline transition-colors duration-150 hover:underline"
    >
      <TriangleAlert aria-hidden className="size-6 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{text}</span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-soft" />
    </Link>
  );
}
