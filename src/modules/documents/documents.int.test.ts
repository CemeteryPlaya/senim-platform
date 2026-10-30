import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, transaction } from "@/platform/db";
import { sha256Hex } from "@/platform/crypto";
import { resetEnvCache } from "@/platform/env";
import { onDocumentSigned } from "@/modules/deal-core";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeDeal } from "../../../test/factories/documents";
import { mockSignatureProvider } from "./providers/mock-signature";
import {
  completeSigning,
  createContract,
  createStageAct,
  getDocumentPdf,
  listDealDocuments,
  startSigning,
} from "./service";

let storageDir: string;

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(os.tmpdir(), "senim-documents-"));
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = storageDir;
  process.env.SIGNATURE_PROVIDER = "mock";
  resetEnvCache();
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

type Hooks = Parameters<typeof completeSigning>[2];
const noHooks: Hooks = { onFullySigned: async () => {} };

async function signAs(user: Parameters<typeof startSigning>[0], documentId: string, hooks: Hooks = noHooks) {
  const session = await startSigning(user, documentId, "EGOV_QR");
  return completeSigning(user, { documentId, sessionId: session.sessionId }, hooks);
}

describe("createContract", () => {
  it("сохраняет PDF в хранилище, sha256 документа — хэш байтов файла", async () => {
    const { deal, client } = await makeDeal();
    const created = await transaction((tx) => createContract(tx, deal.id));

    const doc = await db.document.findUniqueOrThrow({ where: { id: created.documentId }, include: { file: true } });
    expect(doc).toMatchObject({ kind: "CONTRACT", version: 1, status: "SIGNING", sha256: created.sha256 });
    expect(doc.number).toMatch(/^Д-\d{4}\/\d{4}$/);
    expect(doc.file).toMatchObject({ purpose: "DOCUMENT", contentType: "application/pdf", sha256: created.sha256 });

    const pdf = await getDocumentPdf(client, doc.id);
    expect(sha256Hex(pdf.bytes)).toBe(created.sha256);

    const audit = await db.auditEvent.findMany({ where: { scope: `deal:${deal.id}`, action: "document.created" } });
    expect(audit).toHaveLength(1);
  });

  it("повторный вызов без изменения условий возвращает тот же документ", async () => {
    const { deal } = await makeDeal();
    const a = await transaction((tx) => createContract(tx, deal.id));
    const b = await transaction((tx) => createContract(tx, deal.id));
    expect(b).toEqual(a);
    expect(await db.document.count({ where: { dealId: deal.id } })).toBe(1);
  });

  it("изменение условий — новая версия, старая SUPERSEDED", async () => {
    const { deal } = await makeDeal();
    const v1 = await transaction((tx) => createContract(tx, deal.id));
    await db.deal.update({ where: { id: deal.id }, data: { totalAmount: 1_300_000 } });
    await db.stage.update({ where: { id: deal.stages[1].id }, data: { amount: 675_000 } });
    const v2 = await transaction((tx) => createContract(tx, deal.id));

    expect(v2.documentId).not.toBe(v1.documentId);
    expect(v2.sha256).not.toBe(v1.sha256);
    const docs = await db.document.findMany({ where: { dealId: deal.id }, orderBy: { version: "asc" } });
    expect(docs.map((d) => [d.version, d.status])).toEqual([
      [1, "SUPERSEDED"],
      [2, "SIGNING"],
    ]);
  });

  it("подписанный договор не перевыпускается при изменении условий", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    await signAs(client, documentId);
    await signAs(executor, documentId);
    await db.deal.update({ where: { id: deal.id }, data: { totalAmount: 1_300_000 } });
    await expect(transaction((tx) => createContract(tx, deal.id))).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("подпись", () => {
  it("обе стороны подписали — SIGNED и вызов onFullySigned в той же транзакции", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId, sha256 } = await transaction((tx) => createContract(tx, deal.id));
    const onFullySigned = vi.fn(async () => {});

    expect(await signAs(client, documentId, { onFullySigned })).toEqual({ fullySigned: false });
    expect(onFullySigned).not.toHaveBeenCalled();
    expect(await signAs(executor, documentId, { onFullySigned })).toEqual({ fullySigned: true });
    expect(onFullySigned).toHaveBeenCalledWith(expect.anything(), documentId);

    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId }, include: { signatures: true } });
    expect(doc.status).toBe("SIGNED");
    expect(doc.signedAt).toBeInstanceOf(Date);
    expect(doc.signatures.map((s) => s.party).sort()).toEqual(["CLIENT", "EXECUTOR"]);
    for (const s of doc.signatures) expect(s).toMatchObject({ verified: true, signedSha256: sha256, method: "EGOV_QR" });
  });

  it("с deal-core.onDocumentSigned: подписанный договор переводит сделку в работу", async () => {
    const { deal, client, executor } = await makeDeal({ paymentMode: "MANUAL" });
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    await signAs(client, documentId, { onFullySigned: onDocumentSigned });
    await signAs(executor, documentId, { onFullySigned: onDocumentSigned });
    expect(await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ status: "IN_PROGRESS", signedAt: expect.any(Date) });
  });

  it("ошибка в onFullySigned откатывает подпись второй стороны", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    await signAs(client, documentId);
    await expect(
      signAs(executor, documentId, {
        onFullySigned: async () => {
          throw new Error("deal-core упал");
        },
      }),
    ).rejects.toThrow("deal-core упал");
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId }, include: { signatures: true } });
    expect(doc.status).toBe("SIGNING");
    expect(doc.signatures).toHaveLength(1);
  });

  it("двойное нажатие «Подписать» — одна подпись", async () => {
    const { deal, client } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    const session = await startSigning(client, documentId, "EGOV_QR");
    const results = await Promise.allSettled([
      completeSigning(client, { documentId, sessionId: session.sessionId }, noHooks),
      completeSigning(client, { documentId, sessionId: session.sessionId }, noHooks),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.signature.count({ where: { documentId } })).toBe(1);
  });

  it("сессия, начатая для другого документа, отклоняется", async () => {
    const { deal, client } = await makeDeal();
    const v1 = await transaction((tx) => createContract(tx, deal.id));
    const session = await startSigning(client, v1.documentId, "EGOV_QR");
    await db.deal.update({ where: { id: deal.id }, data: { totalAmount: 1_300_000 } });
    const v2 = await transaction((tx) => createContract(tx, deal.id));

    await expect(completeSigning(client, { documentId: v2.documentId, sessionId: session.sessionId }, noHooks)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await db.signature.count()).toBe(0);
  });

  it("подпись неверного хэша отклоняется", async () => {
    const { deal, client } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    const forged = await mockSignatureProvider.startSigning({
      documentId,
      sha256: "0".repeat(64),
      method: "EGOV_QR",
      signer: { userId: client.id, fullName: client.fullName ?? "" },
    });
    await expect(completeSigning(client, { documentId, sessionId: forged.sessionId }, noHooks)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.signature.count()).toBe(0);
  });

  it("чужой пользователь не может начать или завершить подпись", async () => {
    const { deal, client } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    const stranger = await makeClient();
    const otherExecutor = await makeExecutor();
    await expect(startSigning(stranger, documentId, "EGOV_QR")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startSigning(otherExecutor, documentId, "NCALAYER")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const session = await startSigning(client, documentId, "EGOV_QR");
    await expect(completeSigning(stranger, { documentId, sessionId: session.sessionId }, noHooks)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.signature.count()).toBe(0);
  });

  it("подпись чужим сертификатом (другой ИИН) отклоняется", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId, sha256 } = await transaction((tx) => createContract(tx, deal.id));
    const executorUser = await db.user.findUniqueOrThrow({ where: { id: executor.id } });
    const session = await mockSignatureProvider.startSigning({
      documentId,
      sha256,
      method: "EGOV_QR",
      signer: { userId: executor.id, fullName: "Кто-то", iinLast4: executorUser.iinLast4 ?? undefined },
    });
    await expect(completeSigning(client, { documentId, sessionId: session.sessionId }, noHooks)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("заменённую версию подписать нельзя", async () => {
    const { deal, client } = await makeDeal();
    const v1 = await transaction((tx) => createContract(tx, deal.id));
    await db.deal.update({ where: { id: deal.id }, data: { totalAmount: 1_300_000 } });
    await transaction((tx) => createContract(tx, deal.id));
    await expect(startSigning(client, v1.documentId, "EGOV_QR")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("договор по отменённой сделке не подписывается, даже если подпись начата до отмены", async () => {
    const { deal, client } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    const session = await startSigning(client, documentId, "EGOV_QR");
    await db.deal.update({ where: { id: deal.id }, data: { status: "CANCELLED" } });

    await expect(completeSigning(client, { documentId, sessionId: session.sessionId }, noHooks)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.signature.count()).toBe(0);
  });

  it("акт подписывается, только пока сделка в работе или в споре", async () => {
    const { deal, client } = await makeDeal();
    await transaction((tx) => createContract(tx, deal.id));
    const stage = deal.stages[0];
    await db.stage.update({ where: { id: stage.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    const { documentId } = await transaction((tx) => createStageAct(tx, stage.id));

    for (const status of ["TERMINATED", "CANCELLED", "AWAITING_SIGNATURES"] as const) {
      await db.deal.update({ where: { id: deal.id }, data: { status } });
      await expect(signAs(client, documentId)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    await db.deal.update({ where: { id: deal.id }, data: { status: "DISPUTE" } });
    expect(await signAs(client, documentId)).toEqual({ fullySigned: false });
  });

  it("журнал: подписи сторон и полное подписание в scope сделки", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    await signAs(client, documentId);
    await signAs(executor, documentId);
    const actions = (await db.auditEvent.findMany({ where: { scope: `deal:${deal.id}` }, orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["document.signature.added", "document.signed"]));
    expect(actions.filter((a) => a === "document.signature.added")).toHaveLength(2);
  });
});

describe("акт этапа", () => {
  it("создаётся после приёмки этапа, повтор — тот же акт", async () => {
    const { deal } = await makeDeal();
    await transaction((tx) => createContract(tx, deal.id));
    const stage = deal.stages[0];
    await expect(transaction((tx) => createStageAct(tx, stage.id))).rejects.toMatchObject({ code: "CONFLICT" });

    await db.stage.update({ where: { id: stage.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedBy: "system:auto-accept" } });
    const a = await transaction((tx) => createStageAct(tx, stage.id));
    const b = await transaction((tx) => createStageAct(tx, stage.id));
    expect(b).toEqual(a);
    const doc = await db.document.findUniqueOrThrow({ where: { id: a.documentId } });
    expect(doc).toMatchObject({ kind: "STAGE_ACT", stageId: stage.id, status: "SIGNING" });
    expect(doc.number).toMatch(/^А-\d{4}-1$/);
  });
});

describe("доступ к PDF (IDOR)", () => {
  it("стороны и оператор получают PDF, чужие — NOT_FOUND", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId, sha256 } = await transaction((tx) => createContract(tx, deal.id));
    const operator = await makeOperator();

    for (const user of [client, executor, operator]) {
      const pdf = await getDocumentPdf(user, documentId);
      expect(sha256Hex(pdf.bytes)).toBe(sha256);
      expect(pdf.fileName).toMatch(/\.pdf$/);
    }
    for (const user of [await makeClient(), await makeExecutor()]) {
      await expect(getDocumentPdf(user, documentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(getDocumentPdf(client, "no-such-document")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("список документов сделки: только стороны и оператор, без сведений сертификата", async () => {
    const { deal, client, executor } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));
    await signAs(executor, documentId);

    const [doc] = await listDealDocuments(client, deal.id);
    expect(doc).toMatchObject({ id: documentId, myParty: "CLIENT", canSign: true, pdfUrl: `/api/documents/${documentId}/pdf` });
    expect(doc.signatures).toEqual([{ party: "EXECUTOR", signedAt: expect.any(Date), signedSha256: doc.sha256, method: "EGOV_QR" }]);
    expect(JSON.stringify(doc)).not.toContain("Ағаш");

    const [forExecutor] = await listDealDocuments(executor, deal.id);
    expect(forExecutor).toMatchObject({ myParty: "EXECUTOR", canSign: false });

    await expect(listDealDocuments(await makeClient(), deal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
