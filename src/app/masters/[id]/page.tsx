import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Clock, MapPin, ShieldCheck, Star } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { LEGAL_TYPE } from "@/lib/deal/labels";
import { tenge } from "@/lib/format";
import { Avatar, Badge, ButtonLink, Card } from "@/components/ui";
import type { Portfolio } from "@/components/master-card";

type Review = { author: string; text: string; rating: number };

export default async function MasterPage({ params }: PageProps<"/masters/[id]">) {
  const { id } = await params;
  const [master, user] = await Promise.all([
    db.masterProfile.findUnique({ where: { userId: id }, include: { user: true } }),
    getCurrentUser(),
  ]);
  if (!master) notFound();
  const portfolio = master.portfolio as Portfolio;
  const reviews = master.reviews as Review[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/masters" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Все мастера
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <Avatar name={master.displayName} color={master.user.avatar} size={64} />
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight md:text-3xl">
                {master.displayName}
                {master.verified && <BadgeCheck className="text-brand" />}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span className="flex items-center gap-1">
                  <MapPin size={14} /> {master.user.city}
                </span>
                <span>{LEGAL_TYPE[master.legalType]}</span>
                <span>Опыт {master.yearsExp} лет</span>
                <span className="flex items-center gap-1">
                  <Clock size={14} /> {master.responseTime}
                </span>
              </div>
            </div>
          </div>

          <p className="max-w-2xl">{master.bio}</p>

          <div>
            <h2 className="mb-3 font-bold">Портфолио</h2>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {portfolio.map((p) => (
                <figure key={p.title} className="overflow-hidden rounded-xl border border-line bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image} alt={p.title} className="aspect-[4/3] w-full object-cover" />
                  <figcaption className="px-3 py-2 text-sm">{p.title}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-bold">
              Отзывы по безопасным сделкам <span className="font-normal text-muted">· {master.reviewsCount}</span>
            </h2>
            {reviews.length === 0 && <p className="text-sm text-muted">Пока нет отзывов — мастер недавно на платформе.</p>}
            <div className="space-y-3">
              {reviews.map((r) => (
                <Card key={r.text} className="p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{r.author}</span>
                    <span className="flex">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star key={i} size={13} className={i < r.rating ? "fill-[#E9B44C] text-[#E9B44C]" : "text-line"} />
                      ))}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">{r.text}</p>
                  <Badge tone="green" className="mt-2">
                    Сделка подтверждена
                  </Badge>
                </Card>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat value={master.reviewsCount ? master.rating.toFixed(1) : "—"} label="рейтинг" />
              <Stat value={String(master.completedDeals)} label="сделок" />
              <Stat value={`${master.yearsExp} л.`} label="опыт" />
            </div>
            <div className="mt-4 text-sm text-muted">
              Стоимость работ <span className="font-semibold text-ink">от {tenge(master.priceFrom)}</span>
            </div>
            {user?.role === "CLIENT" ? (
              <ButtonLink href={`/deals/new?master=${master.userId}`} className="mt-4 w-full py-3">
                Предложить безопасную сделку
              </ButtonLink>
            ) : (
              <p className="mt-4 rounded-xl bg-surface-2 p-3 text-xs text-muted">
                Чтобы предложить сделку, войдите в демо как заказчик (меню справа вверху).
              </p>
            )}
          </Card>
          <Card className="space-y-2.5 p-5 text-sm">
            <Check text={master.verified ? "Статус проверен по ИИН/БИН" : "Статус ещё проверяется"} ok={master.verified} />
            <Check text="Работает только через эскроу" ok />
            <Check text="Договор подписывается ЭЦП НУЦ РК" ok />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-xl font-extrabold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Check({ text, ok }: { text: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <ShieldCheck size={16} className={ok ? "text-brand" : "text-muted"} />
      <span className={ok ? "" : "text-muted"}>{text}</span>
    </div>
  );
}
