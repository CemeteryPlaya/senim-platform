import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { ru } from "@/i18n/ru";
import { kycQueue, listDisputes, listMoneyQueue, listRegistrationQueue, listStaleRequests } from "@/modules/operator";
import { Alert, Container, PageHeader, SectionTitle, StatTiles } from "@/ui";
import { requireOperatorPage } from "./_lib/guard";

const t = ru.operator;
const d = t.dashboard;

export const metadata: Metadata = { title: t.title };

/**
 * Главная оператора «B + A»: сводка очередей плитками (StatTiles) и что требует внимания — жёлтые плашки-ссылки.
 * Разделы — в боковом меню (на телефоне — «Меню» в шапке), одно место для списка разделов: модель навигации.
 * Заливной кнопки нет: у сводки нет одного главного действия, оно — в первой плашке.
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

  return (
    <Container className="pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} />
      <div className="flex flex-col gap-8">
        <StatTiles
          label={d.summary}
          items={[
            { label: d.tiles.money, value: String(money.length) },
            { label: d.tiles.registrations, value: String(queue.length) },
            { label: d.tiles.disputes, value: String(openDisputes) },
            { label: d.tiles.kyc, value: String(kyc.length) },
            { label: d.tiles.stale, value: String(stale.length) },
          ]}
        />

        <section aria-labelledby="todo" className="flex min-w-0 flex-col gap-3">
          <SectionTitle id="todo" title={d.todo} />
          {todo.length === 0 ? (
            <Alert tone="accent" title={d.allClear}>
              {d.allClearHint}
            </Alert>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))] gap-3">
              {todo.map((item) => (
                <li key={item.href} className="flex">
                  <TodoLink href={item.href} text={item.text} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Container>
  );
}

/** Жёлтая плашка-ссылка «1 открытый спор →»: значок, текст, стрелка; вся плашка нажимается. */
function TodoLink({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-control flex-1 items-center gap-3 rounded-card bg-warning-soft px-4 py-3 text-base font-semibold text-ink no-underline transition-colors duration-150 hover:underline"
    >
      <TriangleAlert aria-hidden className="size-6 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">{text}</span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-soft" />
    </Link>
  );
}
