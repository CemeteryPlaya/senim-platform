import Link from "next/link";
import { BadgeCheck, MapPin, Star } from "lucide-react";
import { Badge } from "@/components/ui";
import { LEGAL_TYPE } from "@/lib/deal/labels";
import { tenge } from "@/lib/format";
import type { LegalType } from "@/generated/prisma/enums";

export type Portfolio = { title: string; image: string }[];

export function MasterCard({
  master,
}: {
  master: {
    userId: string;
    displayName: string;
    legalType: LegalType;
    specialties: string[];
    rating: number;
    reviewsCount: number;
    completedDeals: number;
    priceFrom: number;
    verified: boolean;
    portfolio: unknown;
    user: { city: string };
  };
}) {
  const cover = (master.portfolio as Portfolio)[0];
  return (
    <Link
      href={`/masters/${master.userId}`}
      className="group overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="aspect-[4/3] overflow-hidden bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {cover && <img src={cover.image} alt={cover.title} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold">
              <span className="truncate">{master.displayName}</span>
              {master.verified && <BadgeCheck size={16} className="shrink-0 text-brand" aria-label="Проверен" />}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <MapPin size={12} /> {master.user.city} · {LEGAL_TYPE[master.legalType]}
            </div>
          </div>
          {master.reviewsCount > 0 ? (
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Star size={14} className="fill-[#E9B44C] text-[#E9B44C]" /> {master.rating.toFixed(1)}
            </span>
          ) : (
            <Badge tone="blue">Новый</Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {master.specialties.map((s) => (
            <span key={s} className="rounded-md bg-ink/5 px-2 py-0.5 text-xs">
              {s}
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
          <span>{master.completedDeals} безопасных сделок</span>
          <span className="font-semibold text-ink">от {tenge(master.priceFrom)}</span>
        </div>
      </div>
    </Link>
  );
}
