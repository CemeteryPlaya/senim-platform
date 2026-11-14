import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../../test/factories";
import { ADDRESS, dealAt, dealOf, makeDeal, makePhoto, signContract } from "../../../../../../../../test/factories/deal";
import { latestDocument, signaturePng, signEcp, signTyped, useDocuments } from "../../../../../../../../test/factories/documents";
import { freshBrowser } from "../../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../../test/factories/session";
import { openDispute, submitReady } from "@/modules/deal-core";
import { createContract, withdrawContract } from "@/modules/documents";
import { transaction } from "@/platform/db";
import { ConsentKind } from "@/gen/senim/identity/v1/identity_pb";
import { identityFake } from "../../../../../../../../test/stubs/identity";
import { completeSigningAction, giveBankConsentAction, signByHandAction, startSigningAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.deal.sign.errors;
const tc = ru.app.masterSteps.sign.consent;
const VERSION = ru.consent.documents.BANK_TRANSFER.version;

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());
beforeEach(() => freshBrowser({ "user-agent": "vitest" }));

const handOf = (documentId: string, party: "CLIENT" | "EXECUTOR") => db.handSignature.findMany({ where: { documentId, party } });
const ecpOf = (documentId: string, party: "CLIENT" | "EXECUTOR") => db.signature.findMany({ where: { documentId, party } });
const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

async function contractOf() {
  const f = await makeDeal();
  const doc = await latestDocument(f.dealId, "CONTRACT");
  await signInAs(f.client);
  return { f, dealId: f.dealId, documentId: doc.id };
}

describe("подпись от руки (signByHandAction)", () => {
  it("ФИО вводом: подпись покупателя одна; двойное нажатие (два параллельных вызова) — одна подпись, оба ответа — успех", async () => {
    const { dealId, documentId } = await contractOf();
    const results = await Promise.all([
      signByHandAction({ dealId, documentId, typedName: "Сапарова Айгерим" }),
      signByHandAction({ dealId, documentId, typedName: "Сапарова Айгерим" }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    const rows = await handOf(documentId, "CLIENT");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.typedName).toBe("Сапарова Айгерим");
    // Повтор позже — тот же успех, подпись всё равно одна.
    expect(codeOf(await signByHandAction({ dealId, documentId, typedName: "Сапарова Айгерим" }))).toBe("ok");
    expect(await handOf(documentId, "CLIENT")).toHaveLength(1);
  });

  it("рисунок PNG с холста: сохранён файл подписи", async () => {
    const { dealId, documentId } = await contractOf();
    const dataUrl = `data:image/png;base64,${Buffer.from(await signaturePng()).toString("base64")}`;
    expect(codeOf(await signByHandAction({ dealId, documentId, imageDataUrl: dataUrl }))).toBe("ok");
    const [row] = await handOf(documentId, "CLIENT");
    expect(row?.imageFileId).not.toBeNull();
    expect(row?.typedName).toBeNull();
  });

  it("не PNG, слишком большой рисунок и короткое ФИО отклоняет схема до модуля: подписи нет", async () => {
    const { dealId, documentId } = await contractOf();
    const jpeg = await signByHandAction({ dealId, documentId, imageDataUrl: "data:image/jpeg;base64,AAAA" });
    const huge = await signByHandAction({ dealId, documentId, imageDataUrl: `data:image/png;base64,${"A".repeat(400_000)}` });
    const short = await signByHandAction({ dealId, documentId, typedName: "А" });
    expect([jpeg, huge, short].map(codeOf)).toEqual(["VALIDATION", "VALIDATION", "VALIDATION"]);
    expect(await handOf(documentId, "CLIENT")).toHaveLength(0);
  });

  it("чужой документ — «не найден» текстом экрана; подписи нет", async () => {
    const { dealId, documentId } = await contractOf();
    await signInAs(await makeClient());
    const stranger = await signByHandAction({ dealId, documentId, typedName: "Чужой Человек" });
    expect(stranger).toMatchObject({ ok: false, code: "NOT_FOUND", error: t.notFound });
    expect(await db.handSignature.count({ where: { documentId } })).toBe(0);
  });

  it("шаг сделки не принимает подпись (по сделке открыт спор) — CONFLICT с текстом экрана, подписи нет", async () => {
    const f = await dealAt("IN_PROGRESS");
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await openDispute(f.client, { dealId: f.dealId, reason: "OTHER", description: "Дверца не закрывается до конца" });
    await signInAs(f.client);
    expect(await signByHandAction({ dealId: f.dealId, documentId: act.id, typedName: "Сапарова Айгерим" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.changed });
    expect(await handOf(act.id, "CLIENT")).toHaveLength(0);
  });
});

describe("подпись ЭЦП (startSigningAction → completeSigningAction, мок-провайдер)", () => {
  it("QR и срок сессии; проверка — подпись принята; двойное нажатие «проверить» — одна подпись", async () => {
    const { dealId, documentId } = await contractOf();
    const started = await startSigningAction({ dealId, documentId, method: "EGOV_QR" });
    if (!started.ok) throw new Error(started.error);
    expect(started.data.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(started.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(started.data).sort()).toEqual(["expiresAt", "method", "provider", "qrImage", "sessionId"]);
    const results = await Promise.all([
      completeSigningAction({ dealId, documentId, sessionId: started.data.sessionId }),
      completeSigningAction({ dealId, documentId, sessionId: started.data.sessionId }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(await ecpOf(documentId, "CLIENT")).toHaveLength(1);
  });

  it("подпись уже есть — начать заново нельзя (CONFLICT текстом экрана)", async () => {
    const { f, dealId, documentId } = await contractOf();
    await signEcp(f.client, documentId);
    expect(await startSigningAction({ dealId, documentId, method: "EGOV_QR" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.changed });
  });

  it("испорченная сессия — подпись не принята (VALIDATION), подписи нет", async () => {
    const { dealId, documentId } = await contractOf();
    expect(await completeSigningAction({ dealId, documentId, sessionId: "broken.session" })).toMatchObject({ ok: false, code: "VALIDATION", error: t.rejected });
    expect(await ecpOf(documentId, "CLIENT")).toHaveLength(0);
  });
});

describe("заменённая редакция и последний подписант", () => {
  it("оферту заменили новой редакцией — CONFLICT «документ заменили», подписи нет", async () => {
    const { f, dealId, documentId } = await contractOf();
    await transaction((tx) => withdrawContract(tx, f.dealId));
    await transaction((tx) => createContract(tx, f.dealId));
    expect(await signByHandAction({ dealId, documentId, typedName: "Сапарова Айгерим" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.superseded });
    expect(await handOf(documentId, "CLIENT")).toHaveLength(0);
  });

  it("акт: покупатель — последний подписант; двойное нажатие «проверить» — оба ответа успех, подпись одна, акт подписан", async () => {
    const f = await dealAt("IN_PROGRESS");
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signTyped(f.client, act.id);
    await signInAs(f.client);
    const s = await startSigningAction({ dealId: f.dealId, documentId: act.id, method: "EGOV_QR" });
    if (!s.ok) throw new Error(s.error);
    const results = await Promise.all([
      completeSigningAction({ dealId: f.dealId, documentId: act.id, sessionId: s.data.sessionId }),
      completeSigningAction({ dealId: f.dealId, documentId: act.id, sessionId: s.data.sessionId }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(results.some((r) => r.ok && r.data.fullySigned)).toBe(true);
    expect(await ecpOf(act.id, "CLIENT")).toHaveLength(1);
    expect((await db.document.findUniqueOrThrow({ where: { id: act.id } })).status).toBe("SIGNED");
  });
});

describe("оферта и акт целиком", () => {
  it("покупатель подписывает оферту от руки и ЭЦП, мастер — тоже: оферта заключена", async () => {
    const { f, dealId, documentId } = await contractOf();
    expect(await signByHandAction({ dealId, documentId, typedName: "Сапарова Айгерим" })).toEqual({ ok: true, data: { fullySigned: false } });
    const s = await startSigningAction({ dealId, documentId, method: "NCALAYER" });
    if (!s.ok) throw new Error(s.error);
    expect(await completeSigningAction({ dealId, documentId, sessionId: s.data.sessionId })).toEqual({ ok: true, data: { fullySigned: false } });
    await signTyped(f.executor, documentId);
    await signEcp(f.executor, documentId);
    expect((await dealOf(f.dealId)).signedAt).not.toBeNull();
  });

  it("принять мебель: мастер подписал акт ЭЦП, покупатель — от руки и ЭЦП → сделка ACCEPTED", async () => {
    const f = await dealAt("IN_PROGRESS");
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signEcp(f.executor, act.id);
    await signInAs(f.client);
    expect((await signByHandAction({ dealId: f.dealId, documentId: act.id, typedName: "Сапарова Айгерим" })).ok).toBe(true);
    const s = await startSigningAction({ dealId: f.dealId, documentId: act.id, method: "EGOV_QR" });
    if (!s.ok) throw new Error(s.error);
    expect(await completeSigningAction({ dealId: f.dealId, documentId: act.id, sessionId: s.data.sessionId })).toEqual({ ok: true, data: { fullySigned: true } });
    expect((await dealOf(f.dealId)).status).toMatch(/^(ACCEPTED|SPLIT_PAYOUT)$/);
  });
});

describe("мастер: оферта с согласием для банка, акт — ЭЦП", () => {
  const bankConsentOf = (userId: string, dealId: string) => identityFake.consentsOf(userId).filter((c) => c.kind === ConsentKind.BANK_TRANSFER && c.referenceId === dealId);

  /** Оферта; согласие для банка — только у покупателя (мастер своё ещё не дал); вошёл мастер. */
  async function masterContract(bankConsents: readonly ("CLIENT" | "EXECUTOR")[] = ["CLIENT"]) {
    const f = await makeDeal({ bankConsents });
    const doc = await latestDocument(f.dealId, "CONTRACT");
    await signInAs(f.executor);
    return { f, dealId: f.dealId, documentId: doc.id };
  }

  it("без согласия — отказ у отметки (от руки и начало ЭЦП): подписи нет, согласия нет", async () => {
    const { f, dealId, documentId } = await masterContract();
    const hand = await signByHandAction({ dealId, documentId, typedName: "Жумабаев Ерлан" });
    expect(hand).toMatchObject({ ok: false, code: "VALIDATION", error: tc.missing, fieldErrors: { agreed: [tc.missing] } });
    const ecp = await startSigningAction({ dealId, documentId, method: "EGOV_QR" });
    expect(ecp).toMatchObject({ ok: false, code: "VALIDATION", error: tc.missing });
    expect(await handOf(documentId, "EXECUTOR")).toHaveLength(0);
    expect(bankConsentOf(f.executor.id, dealId)).toHaveLength(0);
  });

  it("с отметкой: двойное нажатие (два параллельных вызова) — согласие одно, подпись от руки одна, оба ответа успех", async () => {
    const { f, dealId, documentId } = await masterContract();
    const input = { dealId, documentId, agreed: "on" as const, version: VERSION, typedName: "Жумабаев Ерлан" };
    const results = await Promise.all([signByHandAction(input), signByHandAction(input)]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(await handOf(documentId, "EXECUTOR")).toHaveLength(1);
    expect(bankConsentOf(f.executor.id, dealId)).toHaveLength(1);
  });

  it("согласие уже дано — подпись без отметки проходит; ЭЦП: «проверить» дважды — одна подпись; обе стороны подписали — оферта заключена", async () => {
    const { f, dealId, documentId } = await masterContract(["CLIENT", "EXECUTOR"]);
    expect(codeOf(await signByHandAction({ dealId, documentId, typedName: "Жумабаев Ерлан" }))).toBe("ok");
    const s = await startSigningAction({ dealId, documentId, method: "EGOV_QR" });
    if (!s.ok) throw new Error(s.error);
    const results = await Promise.all([
      completeSigningAction({ dealId, documentId, sessionId: s.data.sessionId }),
      completeSigningAction({ dealId, documentId, sessionId: s.data.sessionId }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(await ecpOf(documentId, "EXECUTOR")).toHaveLength(1);
    await signTyped(f.client, documentId);
    await signEcp(f.client, documentId);
    expect((await dealOf(dealId)).signedAt).not.toBeNull();
  });

  it("документ чужой сделки при своей сделке с согласием — «документ заменили» (как заменённая редакция), подписи нет", async () => {
    const own = await masterContract(["CLIENT", "EXECUTOR"]);
    const other = await makeDeal({ executor: own.f.executor, bankConsents: ["CLIENT"] });
    const otherDoc = await latestDocument(other.dealId, "CONTRACT");
    expect(await signByHandAction({ dealId: own.dealId, documentId: otherDoc.id, typedName: "Жумабаев Ерлан" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.superseded });
    expect(await handOf(otherDoc.id, "EXECUTOR")).toHaveLength(0);
  });

  it("редакция текста согласия сменилась — CONFLICT с ошибкой у отметки («текст обновился»): ни подписи, ни согласия", async () => {
    const { f, dealId, documentId } = await masterContract();
    const stale = { agreed: "on" as const, version: "1999-01-01" };
    const hand = await signByHandAction({ dealId, documentId, ...stale, typedName: "Жумабаев Ерлан" });
    expect(hand).toMatchObject({ ok: false, code: "CONFLICT", error: tc.changed, fieldErrors: { agreed: [tc.changed] } });
    expect(await startSigningAction({ dealId, documentId, ...stale, method: "EGOV_QR" })).toMatchObject({ ok: false, code: "CONFLICT", error: tc.changed });
    expect(await giveBankConsentAction({ dealId, ...stale })).toMatchObject({ ok: false, code: "CONFLICT", fieldErrors: { agreed: [tc.changed] } });
    expect(await handOf(documentId, "EXECUTOR")).toHaveLength(0);
    expect(bankConsentOf(f.executor.id, dealId)).toHaveLength(0);
  });

  it("оферта подписана без согласия (Ruling 7): «Дать согласие» — без отметки отказ; дважды — одна запись; покупатель этим действием не даёт", async () => {
    const f = await makeDeal({ bankConsents: ["CLIENT"] });
    await signContract(f.dealId);
    await signInAs(f.executor);
    const unchecked = { dealId: f.dealId, version: VERSION } as unknown as Parameters<typeof giveBankConsentAction>[0];
    expect(await giveBankConsentAction(unchecked)).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { agreed: [tc.missing] } });
    const results = await Promise.all([
      giveBankConsentAction({ dealId: f.dealId, agreed: "on", version: VERSION }),
      giveBankConsentAction({ dealId: f.dealId, agreed: "on", version: VERSION }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(bankConsentOf(f.executor.id, f.dealId)).toHaveLength(1);
    await signInAs(f.client);
    expect((await giveBankConsentAction({ dealId: f.dealId, agreed: "on", version: VERSION })).ok).toBe(false);
  });

  it("акт: мастер подписывает только ЭЦП, без согласия для банка; «проверить» дважды — одна подпись", async () => {
    const f = await dealAt("IN_PROGRESS");
    await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
    const act = await latestDocument(f.dealId, "ACCEPTANCE_ACT");
    await signInAs(f.executor);
    const s = await startSigningAction({ dealId: f.dealId, documentId: act.id, method: "EGOV_QR" });
    if (!s.ok) throw new Error(s.error);
    const results = await Promise.all([
      completeSigningAction({ dealId: f.dealId, documentId: act.id, sessionId: s.data.sessionId }),
      completeSigningAction({ dealId: f.dealId, documentId: act.id, sessionId: s.data.sessionId }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(await ecpOf(act.id, "EXECUTOR")).toHaveLength(1);
  });
});
