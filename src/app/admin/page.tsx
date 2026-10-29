import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Coins, Landmark, Lock, TrendingUp, Users } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DEAL_STATUS, LEGAL_TYPE } from "@/lib/deal/labels";
import { moneyOf } from "@/lib/deal/query";
import { dateTime, dealNo, shortDate, tenge } from "@/lib/format";
import { Avatar, Badge, Card, SectionTitle } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { ResolveDispute } from "@/app/deals/[id]/action-panel";
import { ResetDemo, VerifyToggle } from "./admin-controls";

export const metadata: Metadata = { title: "Панель оператора" };

const TX_LABEL = { DEPOSIT: "Пополнение эскроу", RELEASE: "Выплата мастеру", COMMISSION: "Комиссия оператора", REFUND: "Возврат заказчику" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") redirect("/#demo");

  const [deals, masters, txs, disputes] = await Promise.all([
    db.deal.findMany({
      include: { client: true, master: { include: { master: true } }, escrow: true, transactions: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.masterProfile.findMany({ include: { user: true }, orderBy: [{ verified: "asc" }, { completedDeals: "desc" }] }),
    db.transaction.findMany({ include: { deal: true }, orderBy: { createdAt: "desc" }, take: 12 }),
    db.dispute.findMany({
      where: { status: "OPEN" },
      include: { openedBy: true, deal: { include: { client: true, master: true, escrow: true, transactions: true, stages: true } } },
    }),
  ]);

  const sum = (type: string) => deals.flatMap((d) => d.transactions).filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  const inEscrow = deals.reduce((a, d) => a + moneyOf(d).frozen, 0);
  const active = deals.filter((d) => !["COMPLETED", "REFUNDED", "CANCELLED"].includes(d.status)).length;

  const kpis = [
    { label: "Оборот (GMV)", value: tenge(sum("DEPOSIT")), icon: TrendingUp, hint: "внесено на эскроу" },
    { label: "Сейчас на эскроу", value: tenge(inEscrow), icon: Lock, hint: "заморожено до исполнения" },
    { label: "Выплачено мастерам", value: tenge(sum("RELEASE")), icon: Landmark, hint: "после подтверждения этапов" },
    { label: "Доход оператора", value: tenge(sum("COMMISSION")), icon: Coins, hint: "комиссия 6%", accent: true },
    { label: "Активные сделки", value: String(active), icon: Users, hint: `всего ${deals.length}` },
    { label: "Открытые споры", value: String(disputes.length), icon: AlertTriangle, hint: "ждут решения", danger: disputes.length > 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <LiveRefresh interval={6000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Панель оператора</h1>
          <p className="mt-1 text-muted">Контроль сделок, споры, верификация исполнителей, движение денег по эскроу.</p>
        </div>
        <ResetDemo />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`rounded-2xl border p-4 ${k.accent ? "border-brand bg-brand text-white" : "border-line bg-surface"}`}
          >
            <k.icon size={18} className={k.accent ? "text-white/80" : k.danger ? "text-red" : "text-muted"} />
            <div className="tabular mt-3 text-xl font-extrabold">{k.value}</div>
            <div className="text-xs font-semibold">{k.label}</div>
            <div className={`text-[11px] ${k.accent ? "text-white/70" : "text-muted"}`}>{k.hint}</div>
          </div>
        ))}
      </div>

      {disputes.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Споры на рассмотрении</SectionTitle>
          <div className="space-y-3">
            {disputes.map((d) => {
              const stage = d.deal.stages.find((s) => s.id === d.stageId);
              return (
                <Card key={d.id} className="border-red/30 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/deals/${d.deal.id}`} className="font-bold hover:text-brand">
                        {dealNo(d.deal.number)} · {d.deal.title}
                      </Link>
                      <div className="text-sm text-muted">
                        {d.deal.client.name} ↔ {d.deal.master.name} · открыт {dateTime(d.createdAt)}
                        {stage && ` · этап «${stage.title}»`}
                      </div>
                    </div>
                    <Badge tone="red">На эскроу {tenge(moneyOf(d.deal).frozen)}</Badge>
                  </div>
                  <p className="mt-3 rounded-xl bg-red-soft/60 p-3 text-sm">{d.reason}</p>
                  <ResolveDispute disputeId={d.id} frozen={moneyOf(d.deal).frozen} />
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle>Все сделки</SectionTitle>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Сделка</th>
                <th className="px-4 py-3 font-medium">Заказчик → Исполнитель</th>
                <th className="px-4 py-3 text-right font-medium">Сумма</th>
                <th className="px-4 py-3 text-right font-medium">На эскроу</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Обновлена</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const st = DEAL_STATUS[d.status];
                return (
                  <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/deals/${d.id}`} className="font-semibold hover:text-brand">
                        {d.title}
                      </Link>
                      <div className="text-xs text-muted">{dealNo(d.number)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {d.client.name} → {d.master.master?.displayName ?? d.master.name}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-semibold">{tenge(d.amount)}</td>
                    <td className="tabular px-4 py-3 text-right">{moneyOf(d).frozen > 0 ? tenge(moneyOf(d).frozen) : "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{shortDate(d.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Верификация исполнителей</SectionTitle>
          <Card className="divide-y divide-line">
            {masters.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 p-3.5">
                <Avatar name={m.displayName} color={m.user.avatar} size={36} />
                <div className="min-w-0 flex-1 text-sm leading-tight">
                  <div className="truncate font-semibold">{m.displayName}</div>
                  <div className="text-xs text-muted">
                    {LEGAL_TYPE[m.legalType]} · ИИН/БИН {m.user.iin}
                  </div>
                </div>
                <VerifyToggle masterId={m.userId} verified={m.verified} />
              </div>
            ))}
          </Card>
        </section>

        <section>
          <SectionTitle>Журнал проводок</SectionTitle>
          <Card className="divide-y divide-line">
            {txs.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{TX_LABEL[t.type]}</div>
                  <div className="truncate text-xs text-muted">
                    {dealNo(t.deal.number)} · {t.note} · {dateTime(t.createdAt)}
                  </div>
                </div>
                <span className={`tabular shrink-0 font-semibold ${t.type === "COMMISSION" ? "text-brand" : ""}`}>
                  {tenge(t.amount)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
