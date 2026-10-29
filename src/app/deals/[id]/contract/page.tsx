import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { contractSections } from "@/lib/contract";
import { date, dateTime, partyName } from "@/lib/format";
import { BRAND } from "@/lib/brand";
import { PrintButton } from "./print-button";

export const metadata = { title: "Договор подряда" };

export default async function ContractPage({ params }: PageProps<"/deals/[id]/contract">) {
  const { id } = await params;
  const [deal, user] = await Promise.all([
    db.deal.findUnique({
      where: { id },
      include: { client: true, master: { include: { master: true } }, stages: { orderBy: { order: "asc" } }, signatures: true },
    }),
    getCurrentUser(),
  ]);
  if (!deal || !deal.contractNo) notFound();
  if (!user || (user.role !== "ADMIN" && user.id !== deal.clientId && user.id !== deal.masterId)) notFound();

  const sections = contractSections(deal);
  const sigs = deal.signatures.filter((s) => s.revision === deal.revision);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={16} /> К сделке
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-2xl border border-line bg-white p-6 text-[15px] leading-relaxed md:p-10 print:border-0 print:p-0">
        <div className="text-center">
          <div className="text-xs tracking-widest text-muted uppercase">Договор подряда на изготовление мебели</div>
          <h1 className="mt-1 text-2xl font-extrabold">№ {deal.contractNo}</h1>
          <div className="mt-1 text-sm text-muted">
            г. {deal.client.city} · {date(deal.updatedAt)} · заключён через платформу «{BRAND.name}»
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="font-bold">{s.title}</h2>
              <ol className="mt-2 space-y-1.5">
                {s.items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-muted">
                      {s.title.split(".")[0]}.{i + 1}.
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          {(["CLIENT", "MASTER"] as const).map((party) => {
            const sig = sigs.find((s) => s.party === party);
            const person = party === "CLIENT" ? deal.client : deal.master;
            return (
              <div key={party} className="rounded-xl border border-line p-4">
                <div className="text-xs text-muted">{party === "CLIENT" ? "Заказчик" : "Исполнитель"}</div>
                <div className="font-semibold">{partyName(person)}</div>
                {sig ? (
                  <div className="mt-3 rounded-lg border-2 border-blue/40 bg-blue-soft/50 p-3 text-xs text-blue">
                    <div className="flex items-center gap-1.5 font-bold">
                      <ShieldCheck size={14} /> Подписано ЭЦП НУЦ РК
                    </div>
                    <div className="mt-1.5 space-y-0.5 font-mono text-[11px] break-all">
                      <div>ИИН: {sig.iin}</div>
                      <div>Серт.: {sig.certSerial}</div>
                      <div>SHA-256: {sig.docHash.slice(0, 32)}…</div>
                      <div>{dateTime(sig.signedAt)} · {sig.method === "EGOV_QR" ? "eGov Mobile" : "NCALayer"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-line p-3 text-xs text-muted">Ожидает подписи</div>
                )}
              </div>
            );
          })}
        </section>
      </article>
    </div>
  );
}
