import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, FileText, MapPin, Ruler } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { dealInclude, type Viewer } from "@/lib/deal/query";
import { DEAL_STATUS } from "@/lib/deal/labels";
import type { Specs } from "@/lib/contract";
import { date, dealNo } from "@/lib/format";
import { Avatar, Badge, Card, SectionTitle } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { ActionPanel } from "./action-panel";
import { EscrowCard } from "./escrow-card";
import { Feed } from "./feed";
import { Stepper } from "./stepper";
import { StageTimeline } from "./stage-timeline";
import { ViewAs } from "./view-as";

export async function generateMetadata({ params }: PageProps<"/deals/[id]">) {
  const deal = await db.deal.findUnique({ where: { id: (await params).id }, select: { number: true, title: true } });
  return { title: deal ? `${dealNo(deal.number)} · ${deal.title}` : "Сделка" };
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  const [deal, user] = await Promise.all([db.deal.findUnique({ where: { id }, include: dealInclude }), getCurrentUser()]);
  if (!deal) notFound();

  const viewer: Viewer | null =
    user?.role === "ADMIN" ? "ADMIN" : user?.id === deal.clientId ? "CLIENT" : user?.id === deal.masterId ? "MASTER" : null;
  const status = DEAL_STATUS[deal.status];
  const specs = deal.specs as Specs;
  const parties = [
    { id: deal.client.id, name: deal.client.name, avatar: deal.client.avatar, role: "Заказчик" },
    { id: deal.master.id, name: deal.master.master?.displayName ?? deal.master.name, avatar: deal.master.avatar, role: "Исполнитель" },
  ];

  if (!viewer) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Сделка {dealNo(deal.number)} доступна только её участникам</h1>
        <p className="mt-2 text-muted">Войдите за одну из сторон:</p>
        <div className="mt-6">
          <ViewAs parties={parties} currentId={user?.id ?? null} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={viewer === "ADMIN" ? "/admin" : "/deals"} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> {viewer === "ADMIN" ? "Панель оператора" : "Мои сделки"}
        </Link>
        <ViewAs parties={parties} currentId={user?.id ?? null} />
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted">
            Сделка {dealNo(deal.number)} · {deal.furnitureType}
          </div>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight md:text-3xl">{deal.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={status.tone}>{status.label}</Badge>
            {parties.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5">
                <Avatar name={p.name} color={p.avatar} size={22} />
                <span className="text-muted">{p.role}:</span> <span className="font-medium">{p.name}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <Stepper status={deal.status} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <ActionPanel deal={deal} viewer={viewer} />

          <section>
            <SectionTitle>Этапы изготовления</SectionTitle>
            <StageTimeline deal={deal} />
          </section>

          <section>
            <SectionTitle
              action={
                deal.contractNo && (
                  <Link href={`/deals/${deal.id}/contract`} className="flex items-center gap-1 text-sm font-semibold text-brand">
                    <FileText size={15} /> Договор № {deal.contractNo}
                  </Link>
                )
              }
            >
              Условия
            </SectionTitle>
            <Card className="space-y-4 p-5 text-sm">
              <p>{deal.description}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Info icon={<Ruler size={15} />} label="Габариты" value={specs.dimensions} />
                <Info icon={<CalendarDays size={15} />} label="Срок" value={`до ${date(deal.deadline)}`} />
                <Info label="Материалы" value={specs.materials} />
                <Info label="Цвет / отделка" value={specs.color} />
                <Info icon={<MapPin size={15} />} label="Адрес" value={deal.address} />
              </div>
            </Card>
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <EscrowCard deal={deal} />
          <Feed deal={deal} meId={user!.id} canWrite={viewer !== "ADMIN" || deal.status === "DISPUTE"} />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, icon }: { label: string; value?: string; icon?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
