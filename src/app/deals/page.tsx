import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DEAL_STATUS } from "@/lib/deal/labels";
import { needsSigning, nextStep } from "@/lib/deal/next-step";
import { dealNo, partyName, shortDate, tenge } from "@/lib/format";
import { Avatar, Badge, ButtonLink } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Мои сделки" };

export default async function DealsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/#demo");
  if (user.role === "ADMIN") redirect("/admin");

  const deals = await db.deal.findMany({
    where: user.role === "CLIENT" ? { clientId: user.id } : { masterId: user.id },
    include: {
      client: true,
      master: { include: { master: true } },
      stages: { orderBy: { order: "asc" } },
      signatures: true,
      escrow: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const party = user.role === "CLIENT" ? "CLIENT" : "MASTER";
  const active = deals.filter((d) => !["COMPLETED", "REFUNDED", "CANCELLED"].includes(d.status));
  const closed = deals.filter((d) => ["COMPLETED", "REFUNDED", "CANCELLED"].includes(d.status));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <LiveRefresh interval={6000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Мои сделки</h1>
          <p className="mt-1 text-muted">
            {user.name} · {party === "CLIENT" ? "заказчик" : "исполнитель"}
          </p>
        </div>
        {party === "CLIENT" && (
          <ButtonLink href="/masters">
            <Plus size={16} /> Новая сделка
          </ButtonLink>
        )}
      </div>

      {[
        { title: "Активные", list: active },
        { title: "Завершённые", list: closed },
      ].map(
        (group) =>
          group.list.length > 0 && (
            <section key={group.title} className="mt-8">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{group.title}</h2>
              <div className="space-y-3">
                {group.list.map((d) => {
                  const step = nextStep(d);
                  const mine = step.party === party || needsSigning(d, party);
                  const other = party === "CLIENT" ? d.master : d.client;
                  const status = DEAL_STATUS[d.status];
                  return (
                    <Link
                      key={d.id}
                      href={`/deals/${d.id}`}
                      className={`flex items-center gap-4 rounded-2xl border bg-surface p-4 transition hover:shadow-md ${
                        mine ? "border-accent/60 ring-1 ring-accent/30" : "border-line"
                      }`}
                    >
                      <Avatar name={other.name} color={other.avatar} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{d.title}</span>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-sm text-muted">
                          {dealNo(d.number)} · {partyName(other)} · до {shortDate(d.deadline)}
                        </div>
                        <div className={`mt-1.5 text-sm ${mine ? "font-semibold text-accent" : "text-muted"}`}>
                          {mine ? "→ Нужно ваше действие: " : ""}
                          {step.text}
                        </div>
                      </div>
                      <div className="hidden text-right sm:block">
                        <div className="tabular font-bold">{tenge(d.amount)}</div>
                        {d.escrow && d.escrow.funded - d.escrow.released - d.escrow.refunded > 0 && (
                          <div className="text-xs text-muted">
                            в эскроу {tenge(d.escrow.funded - d.escrow.released - d.escrow.refunded)}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={18} className="text-muted" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ),
      )}

      {deals.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          Сделок пока нет.{" "}
          {party === "CLIENT" ? (
            <Link href="/masters" className="font-semibold text-brand">
              Выберите мастера
            </Link>
          ) : (
            "Заказчики найдут вас в каталоге."
          )}
        </div>
      )}
    </div>
  );
}
