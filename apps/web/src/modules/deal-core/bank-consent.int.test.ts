import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { consentTextSha256, seedIdentityBankConsents } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { journalOf, makeDeal, signContract } from "../../../test/factories/deal";
import { freshBrowser, setEnv } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { BANK_CONSENT_MISSING, bankConsentState, giveBankConsent, payForDeal } from "./index";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const e = ru.consent.errors;
const BANK = ru.consent.documents.BANK_TRANSFER.version;
const hasConsentsCalls = () => identityFake.calls.filter((c) => c.method === "hasConsents").length;

/** Подписанная оферта без отметок о передаче данных банку-партнёру (или только с заданными). */
async function signedDeal(bankConsents: readonly ("CLIENT" | "EXECUTOR")[] = []) {
  const f = await makeDeal({ bankConsents });
  await signContract(f.dealId);
  return f;
}

describe("оплата требует согласий обеих сторон на передачу данных банку-партнёру", () => {
  it("нет согласия мастера — CONFLICT BANK_CONSENT_MISSING, ни одной операции в журнале денег", async () => {
    const f = await signedDeal(["CLIENT"]);
    await expect(payForDeal(f.client, { dealId: f.dealId })).rejects.toMatchObject({
      code: "CONFLICT",
      message: e.bankMissingExecutor,
      details: { reason: BANK_CONSENT_MISSING, missing: ["EXECUTOR"] },
    });
    expect(await journalOf(f.dealId)).toEqual([]);
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("CREATED");
  });

  it("нет согласия покупателя — свой текст; нет обоих — тоже покупателю: сначала его отметка", async () => {
    const mine = await signedDeal(["EXECUTOR"]);
    await expect(payForDeal(mine.client, { dealId: mine.dealId })).rejects.toMatchObject({ code: "CONFLICT", message: e.bankMissingClient, details: { missing: ["CLIENT"] } });
    const none = await signedDeal([]);
    await expect(payForDeal(none.client, { dealId: none.dealId })).rejects.toMatchObject({ details: { reason: BANK_CONSENT_MISSING, missing: ["CLIENT", "EXECUTOR"] } });
    expect(await db.moneyTransaction.count()).toBe(0);
  });

  it("согласие к другой сделке не считается", async () => {
    const f = await signedDeal(["CLIENT"]);
    const other = await makeDeal();
    identityFake.grantConsentFor(f.executor.id, "BANK_TRANSFER", { referenceId: other.dealId });
    await expect(payForDeal(f.client, { dealId: f.dealId })).rejects.toMatchObject({ details: { missing: ["EXECUTOR"] } });
  });

  it("обе отметки — оплата проходит (mock: PAID_HOLD)", async () => {
    const f = await signedDeal(["CLIENT", "EXECUTOR"]);
    expect(await payForDeal(f.client, { dealId: f.dealId })).toMatchObject({ status: "SUCCEEDED" });
    expect((await journalOf(f.dealId)).map((t) => t.type)).toEqual(["HOLD"]);
  });

  it("чужая сделка — «не найдено» до запроса согласий: отказ не выдаёт, что сделка есть", async () => {
    const f = await signedDeal([]);
    const stranger = await makeClient();
    await expect(payForDeal(stranger, { dealId: f.dealId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(payForDeal(f.client, { dealId: "no-such-deal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(hasConsentsCalls()).toBe(0);
  });

  it("тестовая сделка при DEMO_MODE — та же проверка: обхода нет; засеянные согласия (SeedConsents) открывают оплату", async () => {
    const f = await signedDeal([]);
    await db.deal.update({ where: { id: f.dealId }, data: { isDemo: true } });
    setEnv({ DEMO_MODE: "true" });
    try {
      await expect(payForDeal(f.client, { dealId: f.dealId })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: BANK_CONSENT_MISSING, missing: ["CLIENT", "EXECUTOR"] } });
      expect(await journalOf(f.dealId)).toEqual([]);
      const proof = { version: BANK, textSha256: consentTextSha256("BANK_TRANSFER") };
      await seedIdentityBankConsents([f.client.id, f.executor.id].map((userId) => ({ ...proof, userId, dealId: f.dealId })));
      expect(await payForDeal(f.client, { dealId: f.dealId })).toMatchObject({ status: "SUCCEEDED" });
    } finally {
      setEnv({ DEMO_MODE: undefined });
    }
  });
});

describe("отметка «Передача данных банку-партнёру» стороной сделки", () => {
  it("мастер до подписи, покупатель перед оплатой: запись в identity к этой сделке с версией и хэшем текста; повтор — та же", async () => {
    const f = await makeDeal({ bankConsents: [] });
    await signInAs(f.executor);
    expect(await bankConsentState(f.executor, f.dealId)).toEqual({ mine: false, other: false });
    await giveBankConsent(f.executor, { dealId: f.dealId, version: BANK });
    await giveBankConsent(f.executor, { dealId: f.dealId, version: BANK });
    const bank = identityFake.consentsOf(f.executor.id).filter((c) => c.referenceId === f.dealId);
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({ channel: "otp_session", version: ru.consent.documents.BANK_TRANSFER.version });
    expect(await bankConsentState(f.executor, f.dealId)).toEqual({ mine: true, other: false });

    freshBrowser();
    await signInAs(f.client);
    expect(await bankConsentState(f.client, f.dealId)).toEqual({ mine: false, other: true });
    await giveBankConsent(f.client, { dealId: f.dealId, version: BANK });
    await signContract(f.dealId);
    expect(await payForDeal(f.client, { dealId: f.dealId })).toMatchObject({ status: "SUCCEEDED" });
  });

  it("редакция текста сменилась между показом и отметкой — CONFLICT «текст обновился», записи нет", async () => {
    const f = await makeDeal({ bankConsents: [] });
    await signInAs(f.executor);
    await expect(giveBankConsent(f.executor, { dealId: f.dealId, version: "2020-01-01" })).rejects.toMatchObject({ code: "CONFLICT", message: e.versionChanged });
    expect(identityFake.consentsOf(f.executor.id).filter((c) => c.referenceId === f.dealId)).toEqual([]);
  });

  it("чужая сделка — «не найдено», оператор — «не ваше действие», после оплаты — CONFLICT; оператору отметка не показывается", async () => {
    const f = await makeDeal();
    const stranger = await makeClient();
    await signInAs(stranger);
    await expect(giveBankConsent(stranger, { dealId: f.dealId, version: BANK })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await bankConsentState(stranger, f.dealId)).toBeNull();

    const op = await makeOperator();
    await expect(giveBankConsent(op, { dealId: f.dealId, version: BANK })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await bankConsentState(op, f.dealId)).toBeNull();

    await signContract(f.dealId);
    await payForDeal(f.client, { dealId: f.dealId });
    await expect(giveBankConsent(f.client, { dealId: f.dealId, version: BANK })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await bankConsentState(f.client, f.dealId)).toBeNull();
  });
});
