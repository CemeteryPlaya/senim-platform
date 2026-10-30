import { afterEach, describe, expect, it } from "vitest";
import { seedDemo } from "@/demo/seed";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeDeal } from "../../../test/factories/operator";
import { getBankDemo } from "./bank-demo";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  resetEnvCache();
}

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("страница показа банку", () => {
  it("без DEMO_MODE недоступна", async () => {
    setDemoMode(false);
    await expect(getBankDemo({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("на демо-данных ведёт по шагам к реальным экранам под нужной персоной", async () => {
    setDemoMode(true);
    await seedDemo(db);

    const demo = await getBankDemo({});

    const byKey = Object.fromEntries(demo.steps.map((s) => [s.key, s]));
    expect(byKey.offers).toMatchObject({ href: expect.stringMatching(/^\/requests\/\w+$/), persona: { role: "CLIENT", phone: expect.stringMatching(/^\+7700/) } });
    expect(byKey.measurement).toMatchObject({ href: "/executor/measurements", persona: { role: "EXECUTOR" } });
    expect(byKey.contract.href).toMatch(/^\/deals\/\w+$/);
    expect(byKey.closing.href).toMatch(/^\/deals\/\w+$/);
    // Все демо-сделки — manual: шага пополнения эскроу ещё нет, страница объясняет, как его получить.
    expect(byKey.deposit).toMatchObject({ href: null, needsEscrow: true });

    expect(demo.selected?.deal.status).toBe("COMPLETED");
    expect(demo.selected?.history.length).toBeGreaterThan(3);
    expect(demo.selected?.history[0].action).toBe("deal.created");
    expect(demo.deals.length).toBeGreaterThan(5);
  });

  it("показывает выбранную сделку с документами, хэшами, подписями и операциями эскроу", async () => {
    setDemoMode(true);
    const { deal, client } = await makeDeal({ paymentMode: "ESCROW_SIMULATOR" });
    const file = await db.storedFile.create({
      data: { storageKey: "doc/1.pdf", provider: "local", purpose: "DOCUMENT", contentType: "application/pdf", size: 10, sha256: "ab".repeat(32) },
    });
    const doc = await db.document.create({
      data: { dealId: deal.id, kind: "CONTRACT", number: "Д-0001/2026", fileId: file.id, sha256: "ab".repeat(32), status: "SIGNED" },
    });
    await db.signature.create({
      data: { documentId: doc.id, userId: client.id, party: "CLIENT", method: "MOCK", signedSha256: "ab".repeat(32), signature: "cms", certSubject: "CN=ТЕСТ", certSerial: "1", verified: true },
    });
    await db.escrowAccount.create({
      data: { dealId: deal.id, rail: "ESCROW_SIMULATOR", externalId: "SIM-1", requisites: {}, status: "FUNDED", deposited: deal.totalAmount },
    });
    await db.paymentOperation.create({
      data: { dealId: deal.id, kind: "DEPOSIT", amount: deal.totalAmount, status: "SUCCEEDED", idempotencyKey: `deposit:${deal.id}`, externalRef: "SIM-DEP-1" },
    });

    const demo = await getBankDemo({ deal: deal.number });

    expect(demo.selected?.deal.number).toBe(deal.number);
    expect(demo.selected?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ number: "Д-0001/2026", sha256: "ab".repeat(32), signatures: [expect.objectContaining({ party: "CLIENT", verified: true })] }),
      ]),
    );
    expect(demo.selected?.escrow).toMatchObject({ externalId: "SIM-1", deposited: deal.totalAmount });
    expect(demo.selected?.operations).toEqual([expect.objectContaining({ kind: "DEPOSIT", idempotencyKey: `deposit:${deal.id}` })]);
  });
});
