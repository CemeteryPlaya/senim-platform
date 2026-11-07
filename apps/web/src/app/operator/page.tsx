import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, ChevronRight, FlaskConical, Handshake, IdCard, Inbox, Landmark, Ruler, Scale, ScrollText, Settings2, Sofa, TriangleAlert, UserCheck, Wallet } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isDemoMode, kycQueue, listDisputes, listMoneyQueue, listRegistrationQueue, listStaleRequests } from "@/modules/operator";
import { isEnabled } from "@/platform/features";
import { Alert, Container, LinkList, PageHeader, SectionTitle, type LinkListItem } from "@/ui";
import { requireOperatorPage } from "./_lib/guard";

const t = ru.operator;
const d = t.dashboard;

export const metadata: Metadata = { title: t.title };

/**
 * Главная оператора по макету кабинета (стр. 12), минималистично: числа — справа в строках меню разделов;
 * что требует внимания — жёлтые плашки; разделы — меню со значками, зелёный пункт — первый, где есть дела.
 */
export default async function OperatorHome() {
  const user = await requireOperatorPage("/operator");
  const [money, queue, kyc, disputes, stale] = await Promise.all([
    listMoneyQueue(user),
    listRegistrationQueue(user),
    kycQueue(user),
    listDisputes(user),
    listStaleRequests(user, { hours: 24 }),
  ]);
  const openDisputes = disputes.filter((x) => x.status === "OPEN").length;
  const todo = [
    money.length > 0 && { href: "/operator/money", text: d.money(money.length) },
    queue.length > 0 && { href: "/operator/executors", text: d.pending(queue.length) },
    openDisputes > 0 && { href: "/operator/disputes", text: d.disputes(openDisputes) },
    kyc.length > 0 && { href: "/operator/kyc", text: d.kyc(kyc.length) },
    stale.length > 0 && { href: "/operator/requests", text: d.stale(stale.length) },
  ].filter((x): x is { href: string; text: string } => Boolean(x));

  const sections: LinkListItem[] = [
    { href: "/operator/money", label: t.nav.money, description: t.nav.moneyHint, icon: <Landmark />, meta: money.length || undefined },
    { href: "/operator/deals", label: t.nav.deals, description: t.nav.dealsHint, icon: <Handshake /> },
    { href: "/operator/executors", label: t.nav.executors, description: t.nav.executorsHint, icon: <UserCheck />, meta: queue.length || undefined },
    { href: "/operator/kyc", label: t.nav.kyc, description: t.nav.kycHint, icon: <IdCard />, meta: kyc.length || undefined },
    { href: "/operator/disputes", label: t.nav.disputes, description: t.nav.disputesHint, icon: <Scale />, meta: openDisputes || undefined },
    { href: "/operator/requests", label: t.nav.requests, description: t.nav.requestsHint, icon: <Inbox />, meta: stale.length || undefined },
    { href: "/operator/furniture-types", label: t.nav.types, description: t.nav.typesHint, icon: <Sofa /> },
    // Справочник цен — для калькулятора материалов (флаг materialsCalculator).
    ...(isEnabled("materialsCalculator") ? [{ href: "/operator/materials", label: ru.materials.nav, description: ru.materials.navHint, icon: <Ruler /> }] : []),
    { href: "/operator/audit", label: t.nav.audit, description: t.nav.auditHint, icon: <ScrollText /> },
    { href: "/operator/income", label: t.nav.income, description: t.nav.incomeHint, icon: <Wallet /> },
    { href: "/operator/report", label: t.nav.report, description: t.nav.reportHint, icon: <ChartColumn /> },
    { href: "/operator/settings", label: t.nav.settings, description: t.nav.settingsHint, icon: <Settings2 /> },
    ...(isDemoMode() ? [{ href: "/operator/demo", label: t.nav.demo, description: t.nav.demoHint, icon: <FlaskConical /> }] : []),
  ];
  // Главный пункт — первый раздел, где ждут дела; если дел нет — «Деньги в банке».
  const main = todo[0]?.href ?? "/operator/money";
  const items = sections.map((s) => ({ ...s, highlight: s.href === main }));

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
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
