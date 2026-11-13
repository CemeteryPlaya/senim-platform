import type { Prisma } from "@/generated/prisma/client";
import { LEDGER_INCLUDE, moneyFacts, toLedgerEntry } from "@/modules/payments";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { isEnabled } from "@/platform/features";
import { nextStep, type NextStep } from "./next-step";
import { partiesDone } from "./signatures";
import { signingFlags } from "./signing-flags";
import { roleIn } from "./state";

/** Ровно то, что читает `nextStep` в `getDealView`, и ничего лишнего (без фото, истории, имён, ссылок на файлы). */
const nextInclude = {
  transactions: { orderBy: { seq: "asc" }, include: LEDGER_INCLUDE },
  documents: {
    where: { status: { not: "SUPERSEDED" } },
    orderBy: { version: "desc" },
    select: { kind: true, signatures: { select: { party: true } }, handSignatures: { select: { party: true } } },
  },
  disputes: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
  review: { select: { id: true } },
} as const satisfies Prisma.DealInclude;

/**
 * «Что дальше» по нескольким сделкам сразу — лёгкая замена `getDealView(...).next` для списков и главной: тот же вход
 * `nextStep` из тех же фактов (подписи документов, журнал денег, последний спор, отзыв), одним запросом на все сделки.
 * Только сделки, где человек — сторона в активной роли (или оператор); чужие и несуществующие id молча пропускаются.
 */
export async function nextStepsOf(user: CurrentUser, dealIds: string[]): Promise<Map<string, NextStep>> {
  const out = new Map<string, NextStep>();
  if (dealIds.length === 0) return out;
  const deals = await db.deal.findMany({ where: { id: { in: [...new Set(dealIds)] } }, include: nextInclude });
  const reviews = isEnabled("reviews");
  for (const deal of deals) {
    const viewer = roleIn(user, deal);
    if (!viewer) continue;
    const signedBy = (kind: "CONTRACT" | "ACCEPTANCE_ACT") => {
      const doc = deal.documents.find((d) => d.kind === kind);
      if (!doc) return [];
      const have = { hand: doc.handSignatures.map((s) => s.party), ecp: doc.signatures.map((s) => s.party) };
      return partiesDone(kind, signingFlags(), have);
    };
    const facts = moneyFacts(deal.transactions.map(toLedgerEntry));
    out.set(
      deal.id,
      nextStep({
        status: deal.status,
        viewer,
        signed: deal.signedAt !== null,
        contractSignedBy: signedBy("CONTRACT"),
        actSignedBy: signedBy("ACCEPTANCE_ACT"),
        hold: facts.hold,
        openDispute: deal.disputes[0]?.status === "OPEN",
        exitRequested: facts.exitRequested,
        canReview: reviews && !deal.review,
      }),
    );
  }
  return out;
}
