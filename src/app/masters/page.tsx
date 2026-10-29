import Link from "next/link";
import clsx from "clsx";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { CITIES, FURNITURE_TYPES } from "@/lib/deal/labels";
import { MasterCard } from "@/components/master-card";

export const metadata: Metadata = { title: "Мастера" };

export default async function MastersPage({ searchParams }: PageProps<"/masters">) {
  const { city, type } = (await searchParams) as { city?: string; type?: string };
  const masters = await db.masterProfile.findMany({
    where: {
      ...(city ? { user: { city } } : {}),
      ...(type ? { specialties: { has: type } } : {}),
    },
    include: { user: true },
    orderBy: [{ verified: "desc" }, { completedDeals: "desc" }],
  });

  const href = (next: { city?: string; type?: string }) => {
    const params = new URLSearchParams();
    const merged = { city, type, ...next };
    if (merged.city) params.set("city", merged.city);
    if (merged.type) params.set("type", merged.type);
    const qs = params.toString();
    return qs ? `/masters?${qs}` : "/masters";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-extrabold tracking-tight">Мастера и мебельные компании</h1>
      <p className="mt-1.5 text-muted">Все исполнители работают через безопасную сделку: оплата только после подтверждения этапов.</p>

      <div className="mt-6 space-y-3">
        <Chips label="Город" items={CITIES} active={city} toHref={(v) => href({ city: v })} />
        <Chips label="Что нужно" items={FURNITURE_TYPES} active={type} toHref={(v) => href({ type: v })} />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {masters.map((m) => (
          <MasterCard key={m.userId} master={m} />
        ))}
      </div>
      {masters.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          По этим фильтрам мастеров пока нет. <Link href="/masters" className="font-semibold text-brand">Сбросить фильтры</Link>
        </div>
      )}
    </div>
  );
}

function Chips({ label, items, active, toHref }: { label: string; items: string[]; active?: string; toHref: (v?: string) => string }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <span className="shrink-0 text-sm text-muted">{label}:</span>
      <Chip href={toHref(undefined)} active={!active}>
        Все
      </Chip>
      {items.map((i) => (
        <Chip key={i} href={toHref(i)} active={active === i}>
          {i}
        </Chip>
      ))}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={clsx(
        "shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap transition",
        active ? "border-brand bg-brand text-white" : "border-line bg-surface hover:border-ink/30",
      )}
    >
      {children}
    </Link>
  );
}
