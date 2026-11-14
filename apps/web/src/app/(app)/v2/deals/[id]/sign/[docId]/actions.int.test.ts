import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../../test/factories";
import { ADDRESS, dealAt, dealOf, makeDeal, makePhoto } from "../../../../../../../../test/factories/deal";
import { latestDocument, signaturePng, signEcp, signTyped, useDocuments } from "../../../../../../../../test/factories/documents";
import { freshBrowser } from "../../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../../test/factories/session";
import { submitReady } from "@/modules/deal-core";
import { completeSigningAction, signByHandAction, startSigningAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.deal.sign.errors;

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
  return { f, documentId: doc.id };
}

describe("подпись от руки (signByHandAction)", () => {
  it("ФИО вводом: подпись покупателя одна; двойное нажатие (два параллельных вызова) — одна подпись, оба ответа — успех", async () => {
    const { documentId } = await contractOf();
    const results = await Promise.all([
      signByHandAction({ documentId, typedName: "Сапарова Айгерим" }),
      signByHandAction({ documentId, typedName: "Сапарова Айгерим" }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    const rows = await handOf(documentId, "CLIENT");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.typedName).toBe("Сапарова Айгерим");
    // Повтор позже — тот же успех, подпись всё равно одна.
    expect(codeOf(await signByHandAction({ documentId, typedName: "Сапарова Айгерим" }))).toBe("ok");
    expect(await handOf(documentId, "CLIENT")).toHaveLength(1);
  });

  it("рисунок PNG с холста: сохранён файл подписи", async () => {
    const { documentId } = await contractOf();
    const dataUrl = `data:image/png;base64,${Buffer.from(await signaturePng()).toString("base64")}`;
    expect(codeOf(await signByHandAction({ documentId, imageDataUrl: dataUrl }))).toBe("ok");
    const [row] = await handOf(documentId, "CLIENT");
    expect(row?.imageFileId).not.toBeNull();
    expect(row?.typedName).toBeNull();
  });

  it("не PNG, слишком большой рисунок и короткое ФИО отклоняет схема до модуля: подписи нет", async () => {
    const { documentId } = await contractOf();
    const jpeg = await signByHandAction({ documentId, imageDataUrl: "data:image/jpeg;base64,AAAA" });
    const huge = await signByHandAction({ documentId, imageDataUrl: `data:image/png;base64,${"A".repeat(400_000)}` });
    const short = await signByHandAction({ documentId, typedName: "А" });
    expect([jpeg, huge, short].map(codeOf)).toEqual(["VALIDATION", "VALIDATION", "VALIDATION"]);
    expect(await handOf(documentId, "CLIENT")).toHaveLength(0);
  });

  it("чужой документ — «не найден» текстом экрана; мастер этим действием не подписывает", async () => {
    const { f, documentId } = await contractOf();
    await signInAs(await makeClient());
    const stranger = await signByHandAction({ documentId, typedName: "Чужой Человек" });
    expect(stranger).toMatchObject({ ok: false, code: "NOT_FOUND", error: t.notFound });
    await signInAs(f.executor);
    expect((await signByHandAction({ documentId, typedName: "Мастер Мастеров" })).ok).toBe(false);
    expect(await db.handSignature.count({ where: { documentId } })).toBe(0);
  });

  it("оферта уже заключена (шаг сделки не тот) — CONFLICT с текстом экрана", async () => {
    const f = await dealAt("SIGNED");
    const doc = await latestDocument(f.dealId, "CONTRACT");
    await signInAs(f.client);
    expect(await signByHandAction({ documentId: doc.id, typedName: "Сапарова Айгерим" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.changed });
  });
});

describe("подпись ЭЦП (startSigningAction → completeSigningAction, мок-провайдер)", () => {
  it("QR и срок сессии; проверка — подпись принята; двойное нажатие «проверить» — одна подпись", async () => {
    const { documentId } = await contractOf();
    const started = await startSigningAction({ documentId, method: "EGOV_QR" });
    if (!started.ok) throw new Error(started.error);
    expect(started.data.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(started.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(started.data).sort()).toEqual(["expiresAt", "method", "provider", "qrImage", "sessionId"]);
    const results = await Promise.all([
      completeSigningAction({ documentId, sessionId: started.data.sessionId }),
      completeSigningAction({ documentId, sessionId: started.data.sessionId }),
    ]);
    expect(results.map(codeOf)).toEqual(["ok", "ok"]);
    expect(await ecpOf(documentId, "CLIENT")).toHaveLength(1);
  });

  it("подпись уже есть — начать заново нельзя (CONFLICT текстом экрана)", async () => {
    const { f, documentId } = await contractOf();
    await signEcp(f.client, documentId);
    expect(await startSigningAction({ documentId, method: "EGOV_QR" })).toMatchObject({ ok: false, code: "CONFLICT", error: t.changed });
  });

  it("испорченная сессия — подпись не принята (VALIDATION), подписи нет", async () => {
    const { documentId } = await contractOf();
    expect(await completeSigningAction({ documentId, sessionId: "broken.session" })).toMatchObject({ ok: false, code: "VALIDATION", error: t.rejected });
    expect(await ecpOf(documentId, "CLIENT")).toHaveLength(0);
  });
});

describe("оферта и акт целиком", () => {
  it("покупатель подписывает оферту от руки и ЭЦП, мастер — тоже: оферта заключена", async () => {
    const { f, documentId } = await contractOf();
    expect(await signByHandAction({ documentId, typedName: "Сапарова Айгерим" })).toEqual({ ok: true, data: { fullySigned: false } });
    const s = await startSigningAction({ documentId, method: "NCALAYER" });
    if (!s.ok) throw new Error(s.error);
    expect(await completeSigningAction({ documentId, sessionId: s.data.sessionId })).toEqual({ ok: true, data: { fullySigned: false } });
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
    expect((await signByHandAction({ documentId: act.id, typedName: "Сапарова Айгерим" })).ok).toBe(true);
    const s = await startSigningAction({ documentId: act.id, method: "EGOV_QR" });
    if (!s.ok) throw new Error(s.error);
    expect(await completeSigningAction({ documentId: act.id, sessionId: s.data.sessionId })).toEqual({ ok: true, data: { fullySigned: true } });
    expect((await dealOf(f.dealId)).status).toMatch(/^(ACCEPTED|SPLIT_PAYOUT)$/);
  });
});
