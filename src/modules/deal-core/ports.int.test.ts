import { afterEach, describe, expect, it } from "vitest";
import { ADDRESS, dealAt, makeDeal, PRICE } from "../../../test/factories/deal";
import { db } from "@/platform/db";
import { dealDocumentData, registerDocumentsPort, type DocumentsPort } from "./index";

const registry = globalThis as unknown as { senimDocumentsPort?: DocumentsPort };

afterEach(() => {
  delete registry.senimDocumentsPort;
});

describe("порт documents", () => {
  it("зарегистрированная реализация вызывается в транзакции createDeal и submitReady", async () => {
    const calls: string[] = [];
    const make = (kind: "CONTRACT" | "ACCEPTANCE_ACT") => async (tx: Parameters<DocumentsPort["createContract"]>[0], dealId: string) => {
      calls.push(`${kind}:${dealId}`);
      const file = await tx.storedFile.create({ data: { storageKey: `x/${kind}/${dealId}`, provider: "local", purpose: "DOCUMENT", contentType: "application/pdf", size: 1, sha256: "a".repeat(64) } });
      const doc = await tx.document.create({ data: { dealId, kind, number: kind, fileId: file.id, sha256: "a".repeat(64) } });
      return { documentId: doc.id, sha256: doc.sha256 };
    };
    registerDocumentsPort({ createContract: make("CONTRACT"), createAcceptanceAct: make("ACCEPTANCE_ACT") });
    const f = await dealAt("READY");
    expect(calls).toEqual([`CONTRACT:${f.dealId}`, `ACCEPTANCE_ACT:${f.dealId}`]);
  });

  it("временный адаптер: оферта без PDF, хэш условий, номер по сделке", async () => {
    const f = await makeDeal();
    const doc = await db.document.findFirstOrThrow({ where: { dealId: f.dealId }, include: { file: true } });
    expect(doc).toMatchObject({ kind: "CONTRACT", status: "SIGNING", version: 1, file: { provider: "pending", purpose: "DOCUMENT" } });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.number).toMatch(/^Д-\d{4}$/);
  });
});

describe("dealDocumentData — данные для оферты, акта и выписки", () => {
  it("суммы, стороны без полных ИИН/БИН, адрес, GPS и фото сдачи, история денег", async () => {
    const f = await dealAt("READY");
    const data = await dealDocumentData(db, f.dealId);
    expect(data.money.priceTiyn).toBe(PRICE);
    expect(data.client).toMatchObject({ id: f.client.id, iinLast4: expect.stringMatching(/^\d{4}$/) });
    expect(data.executor).toMatchObject({ id: f.executor.executor.id, binIinLast4: expect.stringMatching(/^\d{4}$/) });
    expect(data.executor).not.toHaveProperty("binIinEnc");
    expect(data.address).toMatchObject({ addressLat: ADDRESS.lat, addressLng: ADDRESS.lng });
    expect(data.ready).toMatchObject({ lat: ADDRESS.lat, distanceM: 0, withinRadius: true, radiusM: 500 });
    expect(data.ready?.photos).toHaveLength(1);
    expect(data.moneyHistory.map((h) => h.type)).toEqual(["HOLD"]);
  });
});
