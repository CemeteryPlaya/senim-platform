import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { encryptPii } from "@/platform/crypto";
import { db, transaction } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { getOwnPayout, payoutRecipientOf, setPayoutIban } from "./payout";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

/** Реквизиты выплаты мастера: KZ IBAN — в identity (SetPayoutIban), в проекции и интерфейсе — последние 4, журнал — без значения. */
const IBAN = "KZ86125KZT5004100100";
const OTHER = "KZ91125KZT2069100200";
/** Другой счёт с теми же последними 4 символами, что у IBAN. */
const SAME_LAST4 = "KZ75125KZT2069100100";
const t = ru.identity.payout.errors;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const audit = (userId: string) => identityFake.auditEvents.filter((e) => e.userId === userId && e.action === "executor.payout_iban_changed");
const calls = () => identityFake.calls.filter((c) => c.method === "setPayoutIban");

beforeEach(() => freshBrowser());
afterEach(() => vi.restoreAllMocks());

/** Вошедший мастер фабрики: его сторона — в identity (подделка) и в проекции. */
async function signedInExecutor(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const executor = await makeExecutor(opts);
  await signInAs(executor);
  return executor;
}

describe("мастер указывает счёт для выплаты", () => {
  it("IBAN уходит в identity, в проекции — только последние 4; шифртекст в старой базе не пишется", async () => {
    const executor = await signedInExecutor();
    expect(await getOwnPayout(executor)).toEqual({ last4: null });

    expect(await setPayoutIban(executor, { iban: "kz86 125k zt50 0410 0100" })).toEqual({ last4: "0100" });

    expect(calls()[0].request).toMatchObject({ iban: IBAN, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(identityFake.partyNumbersOf(executor.id)?.payoutIban).toBe(IBAN);
    const row = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } });
    expect(row).toMatchObject({ payoutIbanLast4: "0100", payoutIbanEnc: null });
    expect(await getOwnPayout(executor)).toEqual({ last4: "0100" });
  });

  it("смена — журнал identity без значения; тот же IBAN ещё раз — без второй записи", async () => {
    const executor = await signedInExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: OTHER });
    const events = audit(executor.id);
    expect(events.map((e) => [e.before, e.after])).toEqual([
      [{ set: false }, { set: true }],
      [{ set: true }, { set: true }],
    ]);
    const text = JSON.stringify(events);
    for (const part of ["KZ", "0100", "5004", "2069"]) expect(text).not.toContain(part);
  });

  it("указание и смена счёта — уведомление мастеру и операторам с последними 4; повтор того же — без уведомлений", async () => {
    const operator = await makeOperator();
    const executor = await signedInExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: OTHER });
    const notes = await db.notification.findMany({ where: { kind: "executor.payout_iban_changed" }, orderBy: { createdAt: "asc" } });
    expect(notes.filter((x) => x.userId === executor.id).map((x) => x.title)).toEqual(["Счёт для выплаты указан", "Счёт для выплаты изменён"]);
    expect(notes.filter((x) => x.userId === operator.id)).toHaveLength(2);
    const text = JSON.stringify(notes.map((x) => [x.title, x.body]));
    expect(text).toContain("KZ… 0100");
    for (const part of ["KZ86", "KZ91", "5004", "2069"]) expect(text).not.toContain(part);
  });

  it("смена на счёт с теми же последними 4 — уведомление по changed из identity (Ruling V)", async () => {
    const executor = await signedInExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    await setPayoutIban(executor, { iban: SAME_LAST4 });
    await setPayoutIban(executor, { iban: SAME_LAST4 });
    const titles = (await db.notification.findMany({ where: { userId: executor.id, kind: "executor.payout_iban_changed" }, orderBy: { createdAt: "asc" } })).map((x) => x.title);
    expect(titles).toEqual(["Счёт для выплаты указан", "Счёт для выплаты изменён"]);
    expect(identityFake.partyNumbersOf(executor.id)?.payoutIban).toBe(SAME_LAST4);
  });

  it("неверный IBAN — VALIDATION без вызова identity, прежний счёт не меняется", async () => {
    const executor = await signedInExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    expect(await code(setPayoutIban(executor, { iban: "KZ86125KZT5004100101" }))).toBe("VALIDATION");
    expect(await code(setPayoutIban(executor, { iban: "KZ86" }))).toBe("VALIDATION");
    expect(calls()).toHaveLength(1);
    expect(await getOwnPayout(executor)).toEqual({ last4: "0100" });
  });

  it("отказ identity iban_invalid — текст из ru у поля iban по params.reason", async () => {
    const executor = await signedInExecutor();
    identityFake.failNextWithCode("iban_invalid", { reason: "checksum" });
    await expect(setPayoutIban(executor, { iban: IBAN })).rejects.toMatchObject({ code: "VALIDATION", message: t.checksum, details: { fieldErrors: { iban: [t.checksum] } } });
  });

  it("стороны в identity нет (party_missing) — CONFLICT с текстом из ru", async () => {
    const executor = await signedInExecutor();
    identityFake.failNextWithCode("party_missing");
    await expect(setPayoutIban(executor, { iban: IBAN })).rejects.toMatchObject({ code: "CONFLICT", message: t.partyMissing });
  });

  it("без сессии — UNAUTHENTICATED", async () => {
    const executor = await makeExecutor();
    expect(await code(setPayoutIban(executor, { iban: IBAN }))).toBe("UNAUTHENTICATED");
  });

  it("заказчик и оператор счёт мастера не задают и не читают — FORBIDDEN без вызова identity", async () => {
    for (const user of [await makeClient(), await makeOperator()]) {
      expect(await code(setPayoutIban(user, { iban: IBAN }))).toBe("FORBIDDEN");
      expect(await code(getOwnPayout(user))).toBe("FORBIDDEN");
    }
    expect(calls()).toHaveLength(0);
  });

  it("IBAN не попадает в логи", async () => {
    const out = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    out.forEach((spy) => spy.mockImplementation(() => undefined));
    const executor = await signedInExecutor();
    await setPayoutIban(executor, { iban: IBAN });
    identityFake.failNextWithCode("iban_invalid", { reason: "format" });
    await setPayoutIban(executor, { iban: OTHER }).catch(() => undefined);
    const printed = out.flatMap((spy) => spy.mock.calls.flat()).map(String).join("\n");
    expect(printed).not.toContain("5004100100");
    expect(printed).not.toContain("2069100200");
  });
});

describe("payoutRecipientOf — получатель выплаты для deal-core и payments (до Task 12 — по шифртексту старой базы)", () => {
  it("расшифрованный IBAN и наименование; счёт не указан — iban: null", async () => {
    const executor = await makeExecutor({ legalName: "ИП «Дала»" });
    expect(await transaction((tx) => payoutRecipientOf(tx, executor.executor.id))).toEqual({ iban: null, name: "ИП «Дала»" });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { payoutIbanEnc: encryptPii(IBAN), payoutIbanLast4: "0100" } });
    expect(await transaction((tx) => payoutRecipientOf(tx, executor.executor.id))).toEqual({ iban: IBAN, name: "ИП «Дала»" });
  });
});
