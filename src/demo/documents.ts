import type { DocumentKind, SignParty } from "@/generated/prisma/enums";
import { createAcceptanceActIssuedAt, createContractIssuedAt, ensureMoneyStatement } from "@/modules/documents";
import { requiredSignatures } from "@/modules/deal-core";
import type { Tx } from "@/platform/db";

/**
 * Документы демо-сделок через настоящий модуль documents (PDF, sha256, номера), с датами сделки:
 *  - оферта у каждой сделки; если оферта заключена (signedAt) — подписана обеими сторонами;
 *  - акт у каждой сданной сделки (readyAt); если принята (acceptedAt) — подписан;
 *  - выписка по деньгам — по журналу (если операции были).
 * Подписи — честно демонстрационные: ЭЦП методом MOCK («демо-подпись без юридической силы»),
 * собственноручная — напечатанное имя. Повторный запуск не плодит версии: есть документ — не выпускаем.
 */
export async function seedDocuments(tx: Tx): Promise<{ documents: number }> {
  const deals = await tx.deal.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      signedAt: true,
      readyAt: true,
      acceptedAt: true,
      client: { select: { id: true, fullName: true, iinLast4: true } },
      executor: { select: { legalName: true, signerFullName: true, binIinLast4: true, user: { select: { id: true } } } },
      documents: { where: { status: { not: "SUPERSEDED" } }, select: { kind: true } },
    },
  });
  let documents = 0;
  for (const deal of deals) {
    const has = (kind: DocumentKind) => deal.documents.some((d) => d.kind === kind);
    const parties: Record<SignParty, Party> = {
      CLIENT: { userId: deal.client.id, name: deal.client.fullName ?? "", iinLast4: deal.client.iinLast4 },
      EXECUTOR: { userId: deal.executor.user.id, name: deal.executor.signerFullName ?? deal.executor.legalName, iinLast4: deal.executor.binIinLast4 },
    };

    if (!has("CONTRACT")) {
      const contract = await createContractIssuedAt(tx, deal.id, deal.createdAt);
      documents++;
      if (deal.signedAt) await signDemo(tx, contract, "CONTRACT", parties, deal.signedAt);
    }
    if (deal.readyAt && !has("ACCEPTANCE_ACT")) {
      const act = await createAcceptanceActIssuedAt(tx, deal.id, deal.readyAt);
      documents++;
      if (deal.acceptedAt) await signDemo(tx, act, "ACCEPTANCE_ACT", parties, deal.acceptedAt);
    }
    if (await ensureMoneyStatement(tx, deal.id)) documents++;
  }
  return { documents };
}

type Party = { userId: string; name: string; iinLast4: string | null };

/** Все требуемые подписи документа (по той же таблице, что и в приложении) и статус SIGNED. */
async function signDemo(tx: Tx, doc: { documentId: string; sha256: string }, kind: DocumentKind, parties: Record<SignParty, Party>, at: Date) {
  for (const req of requiredSignatures(kind, { executorHandSignsAct: false })) {
    const p = parties[req.party];
    if (req.hand) {
      await tx.handSignature.create({ data: { documentId: doc.documentId, userId: p.userId, party: req.party, typedName: p.name, documentSha256: doc.sha256, signedAt: at } });
    }
    if (req.ecp) {
      await tx.signature.create({
        data: {
          documentId: doc.documentId,
          userId: p.userId,
          party: req.party,
          method: "MOCK",
          signedSha256: doc.sha256,
          signature: "demo",
          certSubject: p.name,
          certSerial: `DEMO-${doc.documentId.slice(-8)}-${req.party}`,
          certIinLast4: p.iinLast4,
          verified: true,
          signedAt: at,
        },
      });
    }
  }
  await tx.document.update({ where: { id: doc.documentId }, data: { status: "SIGNED", signedAt: at } });
}
