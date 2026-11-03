import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cancelDeal, getDealView, payForDeal, startWork, submitReady } from "@/modules/deal-core";
import { jobHandlers as filesJobs } from "@/modules/files";
import { createMockEmailProvider, sendEmail, type EmailMessage, type EmailResult } from "@/modules/notifications";
import { sha256Hex } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { ADDRESS, dealAt, dealOf, journalOf, makeDeal, signContract } from "../../../test/factories/deal";
import { latestDocument, signaturePng, signEcp, signTyped, storedPhoto, useDocuments } from "../../../test/factories/documents";
import { setEnv } from "../../../test/factories/identity";
import { createEmailSignedActHandler, EMAIL_ACT_JOB, partyEmail } from "./email";
import {
  createContract,
  createReleaseReceipt,
  getDocumentPdf,
  getSharedDocumentPdf,
  listDealDocuments,
  openSharedDocument,
  shareDocument,
  signByHand,
  startSigning,
  completeSigning,
} from "./index";
import { sealDocumentLink } from "./links";
import { signedCopyForEmail } from "./read";

const code = (c: string) => expect.objectContaining({ code: c });

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());
afterEach(() => setEnv({ FEATURE_EXECUTOR_HAND_SIGNS_ACT: undefined }));

/** Все подписи оферты: обе стороны собственноручно и ЭЦП. */
async function signContractFully(f: Awaited<ReturnType<typeof makeDeal>>, documentId: string) {
  await signTyped(f.client, documentId);
  await signEcp(f.client, documentId);
  await signByHand(f.executor, { documentId, image: await signaturePng() });
  return signEcp(f.executor, documentId);
}

describe("оферта: PDF, хэш, версии", () => {
  it("createDeal выпускает оферту PDF через порт; хэш документа — хэш байтов; повтор — та же версия", async () => {
    const f = await makeDeal();
    const doc = await latestDocument(f.dealId, "CONTRACT");
    expect(doc.number).toMatch(/^Д-\d{4}\/\d{4}$/);
    const pdf = await getDocumentPdf(f.client, doc.id, "original");
    expect(Buffer.from(pdf.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(sha256Hex(pdf.bytes)).toBe(doc.sha256);
    expect(await transaction((tx) => createContract(tx, f.dealId))).toEqual({ documentId: doc.id, sha256: doc.sha256 });
    expect(await db.document.count({ where: { dealId: f.dealId, kind: "CONTRACT" } })).toBe(1);
  });

  it("подпись обеими сторонами (собственноручно + ЭЦП) → документ SIGNED и Deal.signedAt; до последней подписи — нет", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    await signTyped(f.client, id);
    await signEcp(f.client, id);
    expect(await signByHand(f.executor, { documentId: id, image: await signaturePng() })).toEqual({ fullySigned: false });
    expect((await dealOf(f.dealId)).signedAt).toBeNull();
    expect(await signEcp(f.executor, id)).toEqual({ fullySigned: true });
    expect((await db.document.findUniqueOrThrow({ where: { id } })).status).toBe("SIGNED");
    expect((await dealOf(f.dealId)).signedAt).not.toBeNull();
    const hand = await db.handSignature.findMany({ where: { documentId: id }, orderBy: { party: "asc" } });
    expect(hand.map((h) => [h.party, h.typedName !== null, h.imageFileId !== null])).toEqual([
      ["CLIENT", true, false],
      ["EXECUTOR", false, true],
    ]);
    const image = await db.storedFile.findUniqueOrThrow({ where: { id: hand[1].imageFileId! } });
    expect(image.purpose).toBe("HAND_SIGNATURE");
  });

  it("подписанная копия = исходные страницы + лист подписей; исходный файл не меняется", async () => {
    const f = await makeDeal();
    const { id, sha256 } = await latestDocument(f.dealId, "CONTRACT");
    await signContractFully(f, id);
    const original = await getDocumentPdf(f.client, id, "original");
    const signed = await getDocumentPdf(f.executor, id);
    expect(sha256Hex(original.bytes)).toBe(sha256);
    expect(signed.sha256).toBe(sha256);
    const [a, b] = await Promise.all([PDFDocument.load(original.bytes), PDFDocument.load(signed.bytes)]);
    expect(b.getPageCount()).toBe(a.getPageCount() + 1);
    // Копия детерминирована: те же подписи — те же байты.
    expect(sha256Hex((await getDocumentPdf(f.client, id)).bytes)).toBe(sha256Hex(signed.bytes));
  });

  it("отменённая сделка оферту больше не принимает", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    await cancelDeal(f.client, { dealId: f.dealId });
    await expect(signTyped(f.client, id)).rejects.toEqual(code("CONFLICT"));
    await expect(startSigning(f.client, id, "EGOV_QR")).rejects.toEqual(code("CONFLICT"));
  });
});

describe("гонки и чужие документы", () => {
  it("двойной клик: собственноручная подпись и ЭЦП — по одной записи", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    const hand = await Promise.allSettled([signTyped(f.client, id), signTyped(f.client, id)]);
    expect(hand.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.handSignature.count({ where: { documentId: id } })).toBe(1);

    const [s1, s2] = await Promise.all([startSigning(f.client, id, "EGOV_QR"), startSigning(f.client, id, "EGOV_QR")]);
    const ecp = await Promise.allSettled([completeSigning(f.client, { documentId: id, sessionId: s1.sessionId }), completeSigning(f.client, { documentId: id, sessionId: s2.sessionId })]);
    expect(ecp.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.signature.count({ where: { documentId: id } })).toBe(1);
    await expect(signTyped(f.client, id)).rejects.toEqual(code("CONFLICT"));
  });

  it("чужой документ: не сторона — «не найден» на подпись, PDF и ссылку; оператор видит, но не подписывает", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    const stranger = await makeClient();
    await expect(signTyped(stranger, id)).rejects.toEqual(code("NOT_FOUND"));
    await expect(startSigning(stranger, id, "EGOV_QR")).rejects.toEqual(code("NOT_FOUND"));
    await expect(getDocumentPdf(stranger, id)).rejects.toEqual(code("NOT_FOUND"));
    await expect(shareDocument(stranger, id)).rejects.toEqual(code("NOT_FOUND"));
    await expect(listDealDocuments(stranger, f.dealId)).rejects.toEqual(code("NOT_FOUND"));
    const otherExecutor = await makeExecutor();
    await expect(signEcp(otherExecutor, id)).rejects.toEqual(code("NOT_FOUND"));

    const operator = await makeOperator();
    expect((await getDocumentPdf(operator, id)).sha256).toBeTruthy();
    await expect(signTyped(operator, id)).rejects.toEqual(code("FORBIDDEN"));
  });

  it("подпись чужого документа сессией другого документа (неверный хэш) отклоняется", async () => {
    const f = await makeDeal();
    const g = await makeDeal({ client: f.client });
    const [a, b] = await Promise.all([latestDocument(f.dealId, "CONTRACT"), latestDocument(g.dealId, "CONTRACT")]);
    const session = await startSigning(f.client, a.id, "EGOV_QR");
    await expect(completeSigning(f.client, { documentId: b.id, sessionId: session.sessionId })).rejects.toEqual(code("VALIDATION"));
    expect(await db.signature.count()).toBe(0);
  });

  it("рисунок подписи сохраняет files (HAND_SIGNATURE); уборка сирот его не удаляет", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    await signByHand(f.client, { documentId: id, image: await signaturePng() });
    const hand = await db.handSignature.findFirstOrThrow({ where: { documentId: id }, include: { imageFile: true } });
    expect(hand.imageFile).toMatchObject({ purpose: "HAND_SIGNATURE", contentType: "image/png", uploadedById: f.client.id, storageKey: expect.stringMatching(/^hand_signature\//) });

    await db.storedFile.update({ where: { id: hand.imageFile!.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 3600_000) } });
    await filesJobs["files.cleanupOrphans"]({}, { jobId: "j", attempt: 1, log: { info: () => {}, warn: () => {}, error: () => {} } as never });
    expect(await db.storedFile.count({ where: { id: hand.imageFile!.id } })).toBe(1);
  });

  it("рисунок подписи — только PNG разумного размера", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");
    await expect(signByHand(f.client, { documentId: id, image: new Uint8Array([1, 2, 3]) })).rejects.toEqual(code("VALIDATION"));
    await expect(signByHand(f.client, { documentId: id, typedName: " " })).rejects.toEqual(code("VALIDATION"));
    expect(await db.handSignature.count()).toBe(0);
  });
});

describe("акт приёмки", () => {
  it("сдача → акт с фото и GPS; ЭЦП мастера, затем покупатель собственноручно и ЭЦП → ACCEPTED и выплата в журнале", async () => {
    const f = await makeDeal();
    await signContract(f.dealId);
    await payForDeal(f.client, { dealId: f.dealId });
    await startWork(f.executor, { dealId: f.dealId });
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await storedPhoto(f.executor)], ...ADDRESS, accuracyM: 10 });

    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    expect(act.number).toMatch(/^А-\d{4}$/);
    expect(sha256Hex((await getDocumentPdf(f.client, act.id, "original")).bytes)).toBe(act.sha256);

    // Без флага собственноручная подпись мастера на акте не нужна.
    await expect(signTyped(f.executor, act.id)).rejects.toEqual(code("CONFLICT"));
    expect(await signEcp(f.executor, act.id)).toEqual({ fullySigned: false });
    await signByHand(f.client, { documentId: act.id, image: await signaturePng() });
    expect((await dealOf(f.dealId)).status).toBe("READY");
    expect(await signEcp(f.client, act.id)).toEqual({ fullySigned: true });

    // mock: распоряжение о выплате исполняется сразу после подписи (как оплата) — сделка завершена.
    expect((await dealOf(f.dealId)).status).toBe("SPLIT_PAYOUT");
    const journal = await journalOf(f.dealId);
    expect(journal.map((e) => [e.type, e.status])).toEqual(expect.arrayContaining([["RELEASE", "SUCCEEDED"], ["SPLIT_MASTER", "SUCCEEDED"], ["SPLIT_PLATFORM", "SUCCEEDED"]]));
    const jobs = await db.job.findMany({ where: { kind: EMAIL_ACT_JOB } });
    expect(jobs).toHaveLength(1);
  });

  it("обратный порядок: покупатель подписал всё — READY и «ждём подпись мастера»; ЭЦП мастера → ACCEPTED", async () => {
    const f = await dealAt("READY");
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    expect((await getDealView(f.executor, f.dealId)).next).toEqual({ action: "signActEcp", mine: true });

    await signTyped(f.client, act.id);
    // Одна подпись из двух требуемых — покупатель ещё не «подписал».
    expect((await getDealView(f.client, f.dealId)).act?.signedBy).toEqual([]);
    expect(await signEcp(f.client, act.id)).toEqual({ fullySigned: false });
    expect((await dealOf(f.dealId)).status).toBe("READY");
    const buyer = await getDealView(f.client, f.dealId);
    expect(buyer.act?.signedBy).toEqual(["CLIENT"]);
    expect(buyer.next).toEqual({ action: "waitMasterActSignature", mine: false });
    expect((await getDealView(f.executor, f.dealId)).next).toEqual({ action: "signActEcp", mine: true });

    expect(await signEcp(f.executor, act.id)).toEqual({ fullySigned: true });
    expect((await dealOf(f.dealId)).status).toBe("SPLIT_PAYOUT");
  });

  it("manual: после подписи акта выплата ждёт оператора — сделка ACCEPTED", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    await signEcp(f.client, act.id);
    expect((await dealOf(f.dealId)).status).toBe("ACCEPTED");
    expect((await journalOf(f.dealId)).filter((e) => e.status === "PENDING").map((e) => e.type)).toEqual(expect.arrayContaining(["RELEASE"]));
  });

  it("флаг executorHandSignsAct: без собственноручной подписи мастера акт не подписан полностью", async () => {
    setEnv({ FEATURE_EXECUTOR_HAND_SIGNS_ACT: "true" });
    const f = await dealAt("READY");
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    expect(await signEcp(f.client, act.id)).toEqual({ fullySigned: false });
    expect((await dealOf(f.dealId)).status).toBe("READY");
    expect(await signTyped(f.executor, act.id)).toEqual({ fullySigned: true });
    expect((await dealOf(f.dealId)).status).toBe("SPLIT_PAYOUT");
  });

  it("письмо с подписанным актом — тем, у кого в профиле e-mail; ключ act:<документ>:<адресат> — повтор задачи второе письмо не шлёт", async () => {
    const f = await dealAt("READY");
    await db.user.update({ where: { id: f.client.id }, data: { email: "buyer@example.kz" } });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    await signEcp(f.client, act.id);

    const provider = createMockEmailProvider();
    const sent: (EmailMessage & EmailResult)[] = [];
    const send = async (m: EmailMessage) => {
      const result = await sendEmail(m, provider);
      sent.push({ ...m, ...result });
      return result;
    };
    const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Parameters<ReturnType<typeof createEmailSignedActHandler>>[1]["log"];
    const handler = createEmailSignedActHandler({ send, emailOf: partyEmail, signedCopy: signedCopyForEmail });
    await handler({ documentId: act.id }, { jobId: "j", attempt: 1, log });
    await handler({ documentId: act.id }, { jobId: "j", attempt: 2, log });

    expect(sent.map((m) => [m.to, m.idempotencyKey, m.duplicate])).toEqual([
      ["buyer@example.kz", `act:${act.id}:${f.client.id}`, false],
      ["buyer@example.kz", `act:${act.id}:${f.client.id}`, true],
    ]);
    expect(sent[0].attachments?.[0]).toMatchObject({ contentType: "application/pdf", filename: expect.stringMatching(/\.pdf$/) });
  });

  it("e-mail сторон не указан — письмо не отправляем и не падаем", async () => {
    const f = await dealAt("READY");
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    await signEcp(f.client, act.id);
    const sent: EmailMessage[] = [];
    const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Parameters<ReturnType<typeof createEmailSignedActHandler>>[1]["log"];
    const none = createEmailSignedActHandler({ send: async (m) => (sent.push(m), { providerMessageId: "x", duplicate: false }), emailOf: partyEmail, signedCopy: signedCopyForEmail });
    await expect(none({ documentId: act.id }, { jobId: "j", attempt: 1, log })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});

describe("выписка, расписка, ссылки", () => {
  it("выписка по деньгам появляется с первой операцией журнала и обновляется версией при изменении журнала", async () => {
    const f = await makeDeal();
    expect((await listDealDocuments(f.client, f.dealId)).map((d) => d.kind)).toEqual(["CONTRACT"]);
    await signContract(f.dealId);
    await payForDeal(f.client, { dealId: f.dealId });
    const first = (await listDealDocuments(f.client, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT");
    expect(first).toMatchObject({ signable: false, number: expect.stringMatching(/^В-\d{4}$/) });
    expect((await listDealDocuments(f.executor, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT")?.id).toBe(first?.id);

    await startWork(f.executor, { dealId: f.dealId });
    await db.moneyTransaction.updateMany({ where: { dealId: f.dealId }, data: { settledAt: new Date(Date.now() + 60_000) } });
    const second = (await listDealDocuments(f.client, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT");
    expect(second?.id).not.toBe(first?.id);
    expect((await db.document.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe("SUPERSEDED");
  });

  it("расписка на раскрытие: только оператор и только после запроса раскрытия", async () => {
    const f = await dealAt("READY");
    const operator = await makeOperator();
    await expect(createReleaseReceipt(f.client, f.dealId)).rejects.toEqual(code("FORBIDDEN"));
    await expect(createReleaseReceipt(operator, f.dealId)).rejects.toEqual(code("CONFLICT"));
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    await signEcp(f.client, act.id);
    const receipt = await createReleaseReceipt(operator, f.dealId);
    expect(await createReleaseReceipt(operator, f.dealId)).toEqual(receipt);
    // Сторонам расписка в списке не показывается — это бумага для банка.
    expect((await listDealDocuments(f.client, f.dealId)).map((d) => d.kind)).not.toContain("RELEASE_RECEIPT");
    expect((await listDealDocuments(operator, f.dealId)).map((d) => d.kind)).toContain("RELEASE_RECEIPT");
  });

  it("ссылка «Поделиться» (акт): открывает документ без входа, подделка — нет; WhatsApp без персональных данных", async () => {
    const f = await dealAt("READY");
    const { id, sha256 } = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    const link = await shareDocument(f.client, id);
    const token = new URL(link.url).pathname.split("/").at(-1)!;
    expect(token.startsWith(id)).toBe(true);
    expect(decodeURIComponent(link.whatsappUrl)).not.toMatch(new RegExp(f.client.fullName ?? "—"));
    expect(await openSharedDocument(token)).toMatchObject({ kind: "ACCEPTANCE_ACT", sha256 });
    expect((await getSharedDocumentPdf(token, "original")).sha256).toBe(sha256);
    expect(await openSharedDocument(`${token.slice(0, -2)}xx`)).toBeNull();
    await expect(getSharedDocumentPdf(`${token.slice(0, -2)}xx`)).rejects.toEqual(code("NOT_FOUND"));
    expect(await db.auditEvent.count({ where: { action: "document.link.opened" } })).toBe(1);
  });

  it("оферта (полные ИИН/БИН) по ссылке не выдаётся: ни ссылки, ни открытия старой; скачать сторона может; акт и выписка — можно", async () => {
    const f = await dealAt("PAID_HOLD");
    const contract = await latestDocument(f.dealId, "CONTRACT");
    await expect(shareDocument(f.client, contract.id)).rejects.toEqual(code("FORBIDDEN"));
    await expect(shareDocument(await makeOperator(), contract.id)).rejects.toEqual(code("FORBIDDEN"));
    const { token } = sealDocumentLink(contract.id);
    expect(await openSharedDocument(token)).toBeNull();
    await expect(getSharedDocumentPdf(token)).rejects.toEqual(code("NOT_FOUND"));
    expect((await getDocumentPdf(f.client, contract.id)).bytes.length).toBeGreaterThan(0);

    const docs = await listDealDocuments(f.client, f.dealId);
    expect(Object.fromEntries(docs.map((d) => [d.kind, d.shareable]))).toEqual({ CONTRACT: false, MONEY_STATEMENT: true });
    const statement = docs.find((d) => d.kind === "MONEY_STATEMENT")!;
    expect((await shareDocument(f.client, statement.id)).url).toContain("/d/");
  });
});
