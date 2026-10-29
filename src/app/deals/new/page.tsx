import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { NewDealForm } from "./new-deal-form";
import { Avatar } from "@/components/ui";
import { LEGAL_TYPE } from "@/lib/deal/labels";

export const metadata: Metadata = { title: "Новая сделка" };

export default async function NewDealPage({ searchParams }: PageProps<"/deals/new">) {
  const { master: masterId } = (await searchParams) as { master?: string };
  const user = await getCurrentUser();
  if (user?.role !== "CLIENT") redirect("/masters");
  const master = masterId ? await db.masterProfile.findUnique({ where: { userId: masterId }, include: { user: true } }) : null;
  if (!master) redirect("/masters");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-extrabold tracking-tight">Новая безопасная сделка</h1>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="text-muted">Исполнитель:</span>
        <Avatar name={master.displayName} color={master.user.avatar} size={28} />
        <span className="font-semibold">{master.displayName}</span>
        <span className="text-muted">· {LEGAL_TYPE[master.legalType]}</span>
      </div>
      <NewDealForm masterId={master.userId} defaultType={master.specialties[0]} defaultAddress={`${user.city}, `} />
    </div>
  );
}
