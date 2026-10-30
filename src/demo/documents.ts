import type { SignParty } from "@/generated/prisma/enums";
import { createContractIssuedAt, createStageActIssuedAt } from "@/modules/documents";
import type { Tx } from "@/platform/db";
import { enqueueJob } from "@/platform/jobs";

/**
 * Документы демо-сделок через настоящий модуль documents (PDF, sha256, номера):
 * договор у каждой сделки (подписан обеими сторонами, если сделка подписана),
 * акт у каждого принятого этапа (подписан, если этап закрыт). Подписи — метод MOCK:
 * в демо ЭЦП имитируется, как и на экране подписи.
 * Плюс задача автоприёмки для сданных этапов — как ставит deal-core при сдаче.
 */
export async function seedDocuments(tx: Tx): Promise<{ documents: number; jobs: number }> {
  const deals = await tx.deal.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      client: { select: { id: true, fullName: true, iinLast4: true } },
      executor: { select: { legalName: true, user: { select: { id: true, iinLast4: true } } } },
      stages: { orderBy: { order: "asc" } },
    },
  });
  let documents = 0;
  let jobs = 0;

  for (const deal of deals) {
    const parties: Party[] = [
      { party: "CLIENT", userId: deal.client.id, subject: deal.client.fullName ?? "", iinLast4: deal.client.iinLast4 },
      { party: "EXECUTOR", userId: deal.executor.user.id, subject: deal.executor.legalName, iinLast4: deal.executor.user.iinLast4 },
    ];

    const contract = await createContractIssuedAt(tx, deal.id, deal.createdAt);
    documents++;
    if (deal.signedAt) await signByBoth(tx, contract.documentId, contract.sha256, parties, deal.signedAt);

    for (const stage of deal.stages) {
      if ((stage.status === "ACCEPTED" || stage.status === "CLOSED") && stage.acceptedAt) {
        const act = await createStageActIssuedAt(tx, stage.id, stage.acceptedAt);
        documents++;
        if (stage.status === "CLOSED") await signByBoth(tx, act.documentId, act.sha256, parties, stage.closedAt ?? stage.acceptedAt);
      }
      if (stage.status === "SUBMITTED" && stage.autoAcceptAt && stage.submittedAt) {
        await enqueueJob(tx, {
          kind: "deal-core.autoAcceptStage",
          payload: { stageId: stage.id, submittedAt: stage.submittedAt.toISOString() },
          runAt: stage.autoAcceptAt,
          dedupeKey: `auto-accept:${stage.id}:${stage.submittedAt.getTime()}`,
        });
        jobs++;
      }
    }
  }
  return { documents, jobs };
}

type Party = { party: SignParty; userId: string; subject: string; iinLast4: string | null };

async function signByBoth(tx: Tx, documentId: string, sha256: string, parties: Party[], at: Date) {
  for (const [i, p] of parties.entries()) {
    await tx.signature.create({
      data: {
        documentId,
        userId: p.userId,
        party: p.party,
        method: "MOCK",
        signedSha256: sha256,
        signature: "demo",
        certSubject: p.subject,
        certSerial: `DEMO-${documentId.slice(-8)}-${i + 1}`,
        certIinLast4: p.iinLast4,
        verified: true,
        signedAt: at,
      },
    });
  }
  await tx.document.update({ where: { id: documentId }, data: { status: "SIGNED", signedAt: at } });
}
